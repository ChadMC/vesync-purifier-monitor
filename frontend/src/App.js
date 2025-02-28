import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './styles.css';

// Helper functions
function getPM25Color(value) {
  if (value <= 12) return '#0d9488'; // Nominal - Green
  if (value <= 35.4) return '#0284c7'; // Moderate - Blue
  if (value <= 55.4) return '#fbbf24'; // Caution - Yellow
  if (value <= 150.4) return '#f97316'; // Warning - Orange
  return '#e11d48'; // Alert - Red
}

function getAirQualityLabel(level) {
  const labels = ['Excellent', 'Good', 'Fair', 'Poor'];
  return labels[level - 1] || 'Unknown';
}

function getStatusLevel(pm25Value) {
  if (pm25Value <= 12) return 'laboratory';
  if (pm25Value <= 35.4) return 'monitoring';
  if (pm25Value <= 55.4) return 'caution';
  return 'alert';
}

// React memo component to prevent unnecessary re-renders of device cards
const DeviceCard = React.memo(({ 
  device, 
  index, 
  isUpdating, 
  deviceId,
  history,
  getTrend
}) => {
  const pm25Value = device.air_quality_value || 0;
  const trend = getTrend(deviceId);
  
  // Track which values are updating
  const updatingValues = device._updatingFields || [];
  
  return (
    <div 
      key={device.name} 
      className={`device-card ${isUpdating ? 'updating' : ''}`}
      data-quality={device.air_quality || 1}
      style={{"--index": index}}
    >
      {/* Remove the fadeIn animation classname when updating */}
      <div className="pm25-display">
        <div className="threshold-line">
          <div className="threshold-mark safe" data-value="0" />
          <div className="threshold-mark" data-value="12" />
          <div className="threshold-mark" data-value="35" />
          <div className="threshold-mark caution" data-value="55" />
          <div className="threshold-mark danger" data-value="150+" />
          {/* Add current value marker */}
          <div 
            className="current-value-marker" 
            style={{
              "--position": `${Math.min(100, (pm25Value / 150) * 100)}%`,
              "backgroundColor": getPM25Color(pm25Value)
            }}
            data-value={pm25Value.toFixed(1)}
          />
        </div>
        <div className="pm25-readout">
          <span className="pm25-label">PM2.5</span>
          <span 
            className={`pm25-value ${trend} ${updatingValues.includes('air_quality_value') ? 'updating' : ''}`}
            style={{ color: getPM25Color(pm25Value) }}
          >
            {pm25Value.toFixed(1)}
          </span>
          <span className="pm25-unit">µg/m³</span>
        </div>
        <MiniChart deviceId={deviceId} currentValue={pm25Value} history={history} />
      </div>
      
      <h3 className="device-name" data-id={`ID:${(10000 + index).toString()}`}>
        {device.name}
      </h3>
      
      <div className={`status-item ${device.is_on ? 'active' : ''}`}>
        <span className="status-label">Operation</span>
        <span className={`status-badge ${device.is_on ? 'on' : 'off'} ${updatingValues.includes('is_on') ? 'updating' : ''}`}>
          {device.is_on ? 'Active' : 'Standby'}
        </span>
      </div>
      
      <div className="status-item">
        <span className="status-label">Mode</span>
        <span className={`mode-badge ${updatingValues.includes('mode') ? 'updating' : ''}`}>
          {device.mode || 'N/A'}
        </span>
      </div>
      
      <div className="status-item">
        <span className="status-label">Fan Speed</span>
        <div className={`fan-speed ${updatingValues.includes('fan_speed') ? 'updating' : ''}`}>
          {[1, 2, 3, 4].map(level => (
            <div
              key={level}
              className={`speed-bar ${level <= device.fan_speed ? 'active' : ''}`}
              style={{ height: `${level * 4}px` }}
              data-level={level}
            />
          ))}
        </div>
      </div>
      
      <div className="status-item">
        <span className="status-label">Air Quality</span>
        <span 
          className={`air-quality-indicator ${updatingValues.includes('air_quality') ? 'updating' : ''}`}
          style={{
            color: getPM25Color(pm25Value),
            background: `${getPM25Color(pm25Value)}10`,
            border: `1px solid ${getPM25Color(pm25Value)}30`
          }}
        >
          {getAirQualityLabel(device.air_quality)}
        </span>
      </div>
      
      <div className="status-item">
        <span className="status-label">Filter Life</span>
        <div className={`filter-life ${updatingValues.includes('filter_life') ? 'updating' : ''}`}>
          <div className="filter-life-text">
            {device.filter_life || 0}
          </div>
          <div className="filter-life-bar">
            <div 
              className="filter-life-fill" 
              style={{"--percent": `${device.filter_life || 0}%`}}
            />
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Improve the comparison to prevent unnecessary rerenders
  // Only update when actual visible data has changed or animation state changes
  return prevProps.isUpdating === nextProps.isUpdating &&
         prevProps.device.name === nextProps.device.name &&
         prevProps.device.is_on === nextProps.device.is_on &&
         prevProps.device.mode === nextProps.device.mode &&
         prevProps.device.fan_speed === nextProps.device.fan_speed &&
         prevProps.device.air_quality === nextProps.device.air_quality &&
         prevProps.device.air_quality_value === nextProps.device.air_quality_value &&
         prevProps.device.filter_life === nextProps.device.filter_life &&
         prevProps.history === nextProps.history;
});

// Mini chart component for historical PM2.5 data
const MiniChart = React.memo(({ deviceId, currentValue, history }) => {
  const chartData = history || [];
  if (!chartData.length) return null;
  
  // Find max value for scaling
  const maxValue = Math.max(...chartData, currentValue);
  
  return (
    <div className="mini-chart">
      {chartData.map((value, index) => (
        <div 
          key={index}
          className={`chart-bar ${index === chartData.length - 1 ? 'current' : ''}`}
          style={{ '--height': `${(value / maxValue) * 100}%` }}
          data-value={value}
        />
      ))}
    </div>
  );
});

function App() {
  const [devices, setDevices] = useState([]);
  const [updatingDevices, setUpdatingDevices] = useState(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const animatingDevicesRef = useRef(new Set());
  const updateTimeoutsRef = useRef({});
  const [deviceHistory, setDeviceHistory] = useState({});
  const socketRef = useRef(null);
  const previousDevicesRef = useRef([]);
  const deviceKeysRef = useRef({}); // Store stable keys for devices
  const initialRenderRef = useRef(true);

  // Generate mock history data for visualization
  const generateMockHistory = useCallback((deviceId, currentValue) => {
    const historyPoints = 8;
    const variance = Math.max(2, currentValue * 0.2); // 20% variance
    
    return Array.from({ length: historyPoints }, (_, i) => {
      // Generate a value that tends toward the current value
      const timeWeight = i / historyPoints;
      const randomVariance = (Math.random() - 0.5) * variance;
      const baseValue = currentValue - randomVariance;
      
      // Make each value in a reasonable range +/- variance
      return Math.max(1, Math.round(baseValue + randomVariance));
    });
  }, []);

  // PM2.5 trend direction
  const getTrend = useCallback((deviceId) => {
    const history = deviceHistory[deviceId];
    if (!history || history.length < 2) return 'stable';
    
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    
    if (current < previous) return 'improving';
    if (current > previous) return 'worsening';
    return 'stable';
  }, [deviceHistory]);

  // Handle device updates
  const handleDeviceUpdate = useCallback((newDevices) => {
    if (!newDevices || newDevices.length === 0) return;
    
    const changedDevices = new Set();
    const prevDevices = previousDevicesRef.current;
    const newHistory = {...deviceHistory};
    
    // Initialize keys if this is the first update
    if (initialRenderRef.current) {
      newDevices.forEach((_, idx) => {
        deviceKeysRef.current[idx] = `device-${Date.now()}-${idx}`;
      });
      initialRenderRef.current = false;
    }
    
    // Process each device individually
    newDevices.forEach((newDev, idx) => {
      const deviceId = `device-${idx}`;
      const oldDev = prevDevices[idx];
      
      // Ensure we preserve the existing key to prevent unmounting
      if (oldDev && oldDev.name) {
        newDev.name = oldDev.name;
      } else if (!deviceKeysRef.current[idx]) {
        deviceKeysRef.current[idx] = `device-${Date.now()}-${idx}`;
        newDev.name = deviceKeysRef.current[idx];
      }
      
      // Check if device has changed
      if (oldDev) {
        const fieldsToCheck = [
          'is_on',
          'mode',
          'fan_speed',
          'air_quality',
          'air_quality_value',
          'filter_life'
        ];
        
        // Track which fields have changed
        const updatedFields = fieldsToCheck.filter(prop => oldDev[prop] !== newDev[prop]);
        
        // Add list of updated fields to the device for UI animation
        if (updatedFields.length > 0) {
          newDev._updatingFields = updatedFields;
          
          if (!animatingDevicesRef.current.has(idx)) {
            changedDevices.add(idx);
            animatingDevicesRef.current.add(idx);
            
            // Clear any existing timeouts for this device
            if (updateTimeoutsRef.current[idx]) {
              clearTimeout(updateTimeoutsRef.current[idx]);
            }
            if (updateTimeoutsRef.current[`fields-${idx}`]) {
              clearTimeout(updateTimeoutsRef.current[`fields-${idx}`]);
            }
            
            // First, set a timeout to clear the _updatingFields after the animation completes
            updateTimeoutsRef.current[`fields-${idx}`] = setTimeout(() => {
              // Clear the updating fields first (animation on specific fields)
              setDevices(currentDevices => {
                return currentDevices.map((currentDev, deviceIdx) => {
                  if (deviceIdx !== idx) return currentDev;
                  // Preserve key to prevent remounting
                  return { ...currentDev, _updatingFields: [] };
                });
              });
            }, 1500);
            
            // Then, set a slightly delayed timeout to remove the device from updating state
            updateTimeoutsRef.current[idx] = setTimeout(() => {
              animatingDevicesRef.current.delete(idx);
              setUpdatingDevices(prev => {
                const next = new Set([...prev]);
                next.delete(idx);
                return next;
              });
            }, 1600);
          }
        } else {
          // Keep previous updating fields if they exist to avoid interrupting animations
          newDev._updatingFields = oldDev._updatingFields || [];
        }

        // Update history if pm2.5 value changed
        if (oldDev.air_quality_value !== newDev.air_quality_value) {
          if (!newHistory[deviceId]) {
            // First time seeing this device, generate mock history
            newHistory[deviceId] = generateMockHistory(deviceId, newDev.air_quality_value);
          } else {
            // Add new value and remove oldest
            newHistory[deviceId] = [
              ...newHistory[deviceId].slice(1), 
              newDev.air_quality_value
            ];
          }
        }
      } else {
        // New device, initialize history
        newHistory[deviceId] = generateMockHistory(deviceId, newDev.air_quality_value || 1);
        newDev._updatingFields = []; // No highlighting for new devices
      }
    });

    // Update devices state while preserving identity
    setDevices(currentDevices => {
      // If there are no devices currently, simply return the new ones
      if (currentDevices.length === 0) {
        return newDevices;
      }
      
      // If count different, rebuild array but preserve keys
      if (currentDevices.length !== newDevices.length) {
        return newDevices;
      }
      
      // If no changes, return current array unchanged
      if (changedDevices.size === 0) {
        return currentDevices;
      }
      
      // Update only changed devices, preserve others
      return currentDevices.map((currentDev, idx) => {
        if (!changedDevices.has(idx)) {
          return currentDev;
        }
        // Update device but preserve key and any ongoing animations
        return {
          ...newDevices[idx]
        };
      });
    });

    if (changedDevices.size > 0) {
      setUpdatingDevices(prev => new Set([...prev, ...changedDevices]));
    }
    
    // Update device history if needed
    if (Object.keys(newHistory).length > 0) {
      setDeviceHistory(prevHistory => {
        // Check if anything actually changed
        let changed = false;
        for (const key in newHistory) {
          if (!prevHistory[key] || JSON.stringify(prevHistory[key]) !== JSON.stringify(newHistory[key])) {
            changed = true;
            break;
          }
        }
        return changed ? newHistory : prevHistory;
      });
    }
    
    // Keep a deep copy of the current devices for the next comparison
    previousDevicesRef.current = JSON.parse(JSON.stringify(newDevices));
    
    if (!isLoaded) {
      setTimeout(() => setIsLoaded(true), 500);
    }
  }, [deviceHistory, isLoaded, generateMockHistory]);

  // Store the device update handler in a ref to avoid dependency cycles
  const handleDeviceUpdateRef = useRef(handleDeviceUpdate);
  
  // Update the ref when the callback changes
  useEffect(() => {
    handleDeviceUpdateRef.current = handleDeviceUpdate;
  }, [handleDeviceUpdate]);

  // Track if socket has been initialized
  const socketInitializedRef = useRef(false);
  
  // Function to manage socket connection - with fewer dependencies
  const connectSocket = useCallback(() => {
    // Return existing socket if it exists and is connected
    if (socketRef.current?.connected) return socketRef.current;
    
    // If already initialized but disconnected, don't log again
    if (!socketInitializedRef.current) {
      console.log('Connecting to WebSocket...');
      socketInitializedRef.current = true;
    }
    
    const socket = io(`http://${window.location.hostname}:5000`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    
    socketRef.current = socket;
    
    // Use the ref for the handler to avoid dependency issues
    socket.on('devices_update', data => {
      handleDeviceUpdateRef.current(data);
    });
    
    return socket;
  }, []); // No dependencies needed
  
  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      console.log('Disconnecting WebSocket...');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // Ref to store the disconnect timeout
  const disconnectTimeoutRef = useRef(null);

  // Handle visibility change with delayed disconnect - with fewer dependencies
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      // Set a 1-minute timeout before disconnecting
      disconnectTimeoutRef.current = setTimeout(() => {
        if (socketRef.current) disconnectSocket();
      }, 60000); // 60 seconds = 1 minute
    } else {
      // User has returned to the tab
      // Clear any pending disconnect timeout
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }
      
      // If socket was disconnected, reconnect
      if (!socketRef.current || !socketRef.current.connected) {
        connectSocket();
      }
    }
  }, []); // No dependencies needed as we use refs
  
  // Keep reference to the visibility handler
  const handleVisibilityChangeRef = useRef(handleVisibilityChange);
  
  // Update the ref when the callback changes
  useEffect(() => {
    handleVisibilityChangeRef.current = handleVisibilityChange;
  }, [handleVisibilityChange]);

  // Socket connection setup with visibility management - simplified
  useEffect(() => {
    // Initial connection once
    connectSocket();
    
    // Wrapper function to use the current ref value
    const visibilityHandler = () => handleVisibilityChangeRef.current();
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', visibilityHandler);
    
    return () => {
      // Clean up on unmount
      document.removeEventListener('visibilitychange', visibilityHandler);
      
      // Clear any pending disconnect timeout
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }
      
      disconnectSocket();
    };
  }, []); // Empty dependency array so it only runs once

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      Object.keys(updateTimeoutsRef.current).forEach(key => {
        const timeout = updateTimeoutsRef.current[key];
        if (timeout) clearTimeout(timeout);
      });
    };
  }, []);

  // Grid overlay component
  const GridOverlay = () => {
    return (
      <div className="grid-overlay">
        {/* Grid lines are handled by CSS */}
      </div>
    );
  };

  // Determine dashboard monitoring state
  const monitoringState = React.useMemo(() => {
    const maxPM25 = devices.reduce((max, d) => Math.max(max, d.air_quality_value || 0), 0);
    return getStatusLevel(maxPM25);
  }, [devices]);

  return (
    <>
      {!isLoaded && (
        <div className="loading">
          <div className="loading-text">
            INITIALIZING AIR QUALITY MONITORING SYSTEM
            <span className="loading-status">Calibrating sensors...</span>
          </div>
          <div className="calibrating" />
        </div>
      )}
      <div className={`dashboard ${monitoringState}`}>
        <GridOverlay />
        <h1 className="title">Air Quality Monitoring System</h1>
        {devices.length === 0 ? (
          <div className="loading">
            <div className="loading-text">
              SYSTEM INITIALIZATION
              <span className="loading-status">Searching for connected devices...</span>
            </div>
            <div className="calibrating" />
          </div>
        ) : (
          <div className="devices-grid">
            {devices.map((dev, idx) => {
              const deviceId = `device-${idx}`;
              return (
                <DeviceCard
                  key={dev.name}
                  device={dev}
                  index={idx}
                  isUpdating={updatingDevices.has(idx)}
                  deviceId={deviceId}
                  history={deviceHistory[deviceId]}
                  getTrend={getTrend}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default App;