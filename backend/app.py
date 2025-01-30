import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS
from dotenv import load_dotenv
import os
import pyvesync.vesync as vs
import time
import threading
import logging
import sys
import colorama
import json
from hashlib import md5

# Initialize colorama for Windows
colorama.init()

# Create console handler with detailed formatting
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.DEBUG)
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
console_handler.setFormatter(formatter)

# Configure root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.addHandler(console_handler)

# Configure our app logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Configure Flask and SocketIO loggers
logging.getLogger('flask').setLevel(logging.DEBUG)
logging.getLogger('socketio').setLevel(logging.DEBUG)
logging.getLogger('engineio').setLevel(logging.DEBUG)
logging.getLogger('werkzeug').setLevel(logging.DEBUG)

# Test logging
logger.debug("Logging system initialized")
logger.info("Starting application...")

# Load environment variables
load_dotenv()

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')
    # Allow any origin for development
    CORS(app, resources={r"/*": {"origins": "*"}})
    return app

app = create_app()
# Allow any origin for SocketIO
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# Add these global variables after the imports
last_device_states = {}
last_change_time = time.time()
last_update_time = 0  # Track when we last called update_all_devices
update_interval = 30  # Default sleep time in seconds
MIN_UPDATE_INTERVAL = 10
MAX_UPDATE_INTERVAL = 30
MAX_UPDATE_INTERVAL_TIME = 120  # Time in seconds to reach max interval (2 minutes)
MAX_STATE_AGE = 59  # Maximum age of device states in seconds

# Initialize VeSync with retry logic
def init_vesync():
    logger.debug("Entering init_vesync()")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            logger.debug(f"Attempting to initialize VeSync (attempt {attempt + 1}/{max_retries})")
            manager = vs.VeSync(
                os.getenv('VESYNC_EMAIL'),
                os.getenv('VESYNC_PASSWORD'),
                debug=False
            )
            
            logger.debug("Attempting VeSync login...")
            if manager.login():
                logger.debug("Login successful")
                manager.update()
                return manager
                
        except Exception as e:
            logger.error(f"Attempt {attempt + 1}/{max_retries} failed: {str(e)}")
        time.sleep(5)
    raise Exception("Failed to initialize VeSync after multiple attempts")

def collect_device_states(manager):
    """Helper function to collect device states in a consistent format"""
    states = {}
    if manager and manager.fans:
        for dev in manager.fans:
            device_info = {
                'name': dev.device_name,
                'model': dev.device_type,
                'is_on': dev.is_on,
                'mode': getattr(dev, 'mode', None),
                'fan_speed': getattr(dev, 'fan_level', None),
                'air_quality': getattr(dev, 'air_quality', None),
                'air_quality_value': dev.details.get('air_quality_value', None) if hasattr(dev, 'details') else None,
                'filter_life': getattr(dev, 'filter_life', None),
            }
            states[dev.device_name] = device_info
    return states

# Initialize VeSync manager (moved before polling thread start)
vesync_manager = None
last_device_states = {}  # Initialize empty dict
try:
    vesync_manager = init_vesync()
    # Immediately populate initial device states
    last_device_states = collect_device_states(vesync_manager)
except Exception as e:
    logger.error(f"Initial VeSync initialization failed: {str(e)}")

def get_device_state_hash(device_info):
    """Create a hash of device state for efficient comparison"""
    return md5(json.dumps(device_info, sort_keys=True).encode()).hexdigest()

@socketio.on('connect')
def handle_connect():
    logger.debug("Client connected - sending immediate device update")
    global vesync_manager, last_device_states, last_update_time

    # First try to send existing states
    if last_device_states:
        logger.debug(f"Sending existing states for {len(last_device_states)} devices")
        socketio.emit('devices_update', list(last_device_states.values()))
    else:
        logger.warning("No existing device states available")

    # Force an immediate update if states are stale or empty
    current_time = time.time()
    needs_update = current_time - last_update_time > MAX_UPDATE_INTERVAL or not last_device_states

    if needs_update and vesync_manager:
        logger.debug("Performing immediate update")
        try:
            vesync_manager.update_all_devices()
            last_update_time = current_time
            
            # Use helper function to collect states
            current_states = collect_device_states(vesync_manager)
            
            if current_states:
                last_device_states.update(current_states)
                logger.debug(f"Emitting fresh states for {len(current_states)} devices")
                socketio.emit('devices_update', list(current_states.values()))
            else:
                logger.warning("No devices found after update")
                
        except Exception as e:
            logger.error(f"Failed to update devices on connect: {str(e)}")

def update_vesync():
    """Thread function to handle VeSync updates"""
    logger.debug("Entering update_vesync()")
    global vesync_manager, last_update_time
    
    while True:
        loop_start_time = time.time()
        try:
            if vesync_manager is None:
                logger.warning("VeSync manager not initialized, attempting initialization...")
                vesync_manager = init_vesync()
                if vesync_manager is None:
                    logger.error("Failed to initialize VeSync manager")
                    time.sleep(15)
                    continue

            # Check if update is needed due to age or active connections
            time_since_update = time.time() - last_update_time
            needs_update = time_since_update >= MAX_STATE_AGE

            if needs_update or socketio.server.manager.rooms:
                update_start = time.time()
                vesync_manager.update_all_devices()
                last_update_time = time.time()
                update_duration = time.time() - update_start
                logger.debug(f"VeSync update took {update_duration:.2f} seconds")
            else:
                logger.debug("Skipping update - states are fresh and no active connections")

        except Exception as e:
            logger.error(f"Update error: {str(e)}")
            try:
                vesync_manager = init_vesync()
            except:
                logger.error("Failed to reinitialize VeSync")

        loop_duration = time.time() - loop_start_time
        sleep_time = max(0, update_interval - loop_duration)
        logger.debug(f"Sleeping for {sleep_time:.2f} seconds (current interval: {update_interval}s)")
        time.sleep(sleep_time)

def check_device_states():
    """Thread function to check device states and emit changes"""
    logger.debug("Entering check_device_states()")
    global vesync_manager, last_device_states, last_change_time, update_interval
    
    while True:
        try:
            if vesync_manager and vesync_manager.fans:
                current_states = collect_device_states(vesync_manager)
                changes_detected = False

                for device_name, device_info in current_states.items():
                    device_hash = get_device_state_hash(device_info)
                    if (device_name not in last_device_states or 
                        get_device_state_hash(last_device_states[device_name]) != device_hash):
                        changes_detected = True
                        logger.debug(f"Change detected for device: {device_name}")

                if changes_detected:
                    logger.debug("Changes detected, emitting update")
                    socketio.emit('devices_update', list(current_states.values()))
                    last_device_states = current_states
                    last_change_time = time.time()
                    update_interval = MIN_UPDATE_INTERVAL
                    logger.debug(f"Update interval set to {update_interval}s due to detected changes")
                else:
                    # Calculate time since last change
                    time_since_change = time.time() - last_change_time
                    if time_since_change < MAX_UPDATE_INTERVAL_TIME:
                        # Linear interpolation between MIN and MAX interval over 2 minutes
                        progress = time_since_change / MAX_UPDATE_INTERVAL_TIME
                        update_interval = MIN_UPDATE_INTERVAL + (MAX_UPDATE_INTERVAL - MIN_UPDATE_INTERVAL) * progress
                        logger.debug(f"Gradually increasing update interval to {update_interval:.1f}s")
                    else:
                        update_interval = MAX_UPDATE_INTERVAL

        except Exception as e:
            logger.error(f"State checking error: {str(e)}")

        time.sleep(1)

@app.route('/')
def index():
    return "Backend is running"

if __name__ == '__main__':
    # Start update thread
    update_thread = threading.Thread(target=update_vesync, daemon=True)
    update_thread.start()
    
    # Start state checking thread
    state_thread = threading.Thread(target=check_device_states, daemon=True)
    state_thread.start()
    
    socketio.run(app, host='0.0.0.0', port=5000)