import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './styles.css';

// Add this function at the top, before the App component
function getPM25Color(value) {
  const colors = [
    { point: 0, color: [14, 165, 233] },    // Blue (#0ea5e9)
    { point: 40, color: [52, 211, 153] },   // Green (#34d399)
    { point: 85, color: [251, 191, 36] },   // Orange (#fbbf24)
    { point: 120, color: [244, 63, 94] }    // Red (#f43f5e)
  ];

  // Find the two colors to interpolate between
  let lower = colors[0];
  let upper = colors[colors.length - 1];
  
  for (let i = 0; i < colors.length - 1; i++) {
    if (value >= colors[i].point && value < colors[i + 1].point) {
      lower = colors[i];
      upper = colors[i + 1];
      break;
    }
  }

  // Calculate the percentage between the two points
  const range = upper.point - lower.point;
  const percent = range ? Math.min(1, (value - lower.point) / range) : 1;

  // Interpolate between the two colors
  const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * percent);
  const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * percent);
  const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * percent);

  return `rgb(${r}, ${g}, ${b})`;
}

// Add this function next to getPM25Color function
function getAirQualityColor(level) {
  switch (level) {
    case 1: return '#0ea5e9'; // Blue - Excellent
    case 2: return '#34d399'; // Green - Good
    case 3: return '#fbbf24'; // Orange - Fair
    case 4: return '#f43f5e'; // Red - Poor
    default: return '#94a3b8'; // Gray - N/A
  }
}

function App() {
  const [devices, setDevices] = useState([]);
  const [updatingDevices, setUpdatingDevices] = useState(new Set());
  const animatingDevicesRef = useRef(new Set());
  const updateTimeoutsRef = useRef([]);
  // Add new ref to store current PM2.5 value
  const currentPM25Ref = useRef(0);
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const frameRef = useRef();
  const particleSystemRef = useRef({
    targetCount: 50,
    spawnRate: 2,
    lastSpawn: 0
  });
  const previousDevicesRef = useRef([]);

  // Update the memoized handler to use ref for comparison
  const handleDeviceUpdate = useCallback((newDevices) => {
    const changedDevices = new Set();
    const prevDevices = previousDevicesRef.current;
    
    newDevices.forEach((newDev, idx) => {
      const oldDev = prevDevices[idx];
      if (oldDev) {
        const hasChanged = [
          'is_on',
          'mode',
          'fan_speed',
          'air_quality',
          'air_quality_value',
          'filter_life'
        ].some(prop => oldDev[prop] !== newDev[prop]);

        if (hasChanged && !animatingDevicesRef.current.has(idx)) {
          changedDevices.add(idx);
          animatingDevicesRef.current.add(idx);
          
          if (updateTimeoutsRef.current[idx]) {
            clearTimeout(updateTimeoutsRef.current[idx]);
          }
          
          updateTimeoutsRef.current[idx] = setTimeout(() => {
            animatingDevicesRef.current.delete(idx);
            setUpdatingDevices(prev => {
              const next = new Set(prev);
              next.delete(idx);
              return next;
            });
          }, 1500);
        }
      }
    });

    if (changedDevices.size > 0) {
      setUpdatingDevices(prev => new Set([...prev, ...changedDevices]));
    }
    
    previousDevicesRef.current = newDevices;
    setDevices(newDevices);
  }, []); // Can keep empty deps since we use refs

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    // Add this new function for initial burst
    const createInitialParticle = () => {
      // Much more aggressive scaling, especially at lower values
      const baseScale = currentPM25Ref.current / 15; // Reduced from 25 to make each point more significant
      const scale = Math.pow(baseScale, 0.4) * (1 + Math.log10(baseScale + 0.5) * 3);
      
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height, // Random position across entire screen
        // Store initial properties that won't change
        initialSize: 0.2 + (Math.random() * 3 * scale), // Wider size range with smaller base
        initialSpeedY: (-0.1 - Math.random() * 0.4) * (1 + scale),
        initialSpeedX: (0.05 + Math.random() * 0.3) * (1 + scale * 0.5),
        initialOpacity: (0.1 + Math.random() * 0.4) * (1 + scale * 0.7),
        // Current state properties
        life: 0.3 + Math.random() * 0.7, // Start with random life stage
        lifeDecrease: 0.0001 + Math.random() * 0.0001
      };
    };

    // Add initial burst function
    const createInitialBurst = () => {
      const scale = Math.pow(currentPM25Ref.current / 35, 1.5);
      const baseCount = 200;
      const maxCount = 800;
      const initialCount = Math.floor(baseCount + (maxCount - baseCount) * scale);
      
      // Create initial burst of particles
      particlesRef.current = Array.from(
        { length: Math.floor(initialCount * 0.9) }, // Increased from 0.7 to 0.8
        createInitialParticle
      );
    };

    // Updated particle creation function
    const createParticle = () => {
      const scale = Math.pow(currentPM25Ref.current / 35, 1.5);
      
      return {
        x: Math.random() * canvas.width,
        y: canvas.height + 10,
        // Store initial properties that won't change
        initialSize: 0.6 + (Math.random() * 2 * scale),
        initialSpeedY: (-0.1 - Math.random() * 0.3) * (1 + scale),
        initialSpeedX: (0.05 + Math.random() * 0.2) * (1 + scale * 0.5),
        initialOpacity: (0.1 + Math.random() * 0.3) * (1 + scale * 0.7),
        // Current state properties
        life: 1.0,
        // Much slower decay rate
        lifeDecrease: 0.0001 + Math.random() * 0.0001
      };
    };

    // Update particle system parameters
    const updateParticleSystem = () => {
      const baseScale = currentPM25Ref.current / 15;
      const scale = Math.pow(baseScale, 0.4) * (1 + Math.log10(baseScale + 0.5) * 3);
      
      const baseCount = 150;  // Reduced base count
      const maxCount = 3500;  // Increased from 800
      
      particleSystemRef.current.targetCount = Math.floor(baseCount + (maxCount - baseCount) * scale);
      particleSystemRef.current.spawnRate = 2 + Math.floor(scale * 15); // More aggressive spawn rate scaling
    };

    const animate = (timestamp) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Spawn new particles if needed
      if (timestamp - particleSystemRef.current.lastSpawn > 1000 / particleSystemRef.current.spawnRate) {
        if (particlesRef.current.length < particleSystemRef.current.targetCount) {
          particlesRef.current.push(createParticle());
        }
        particleSystemRef.current.lastSpawn = timestamp;
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter(particle => {
        // Use initial values for movement
        particle.y += particle.initialSpeedY;
        particle.x += particle.initialSpeedX;

        // Only decrease life when particle reaches upper portion of screen
        if (particle.y < canvas.height * 0.6) {
          particle.life -= particle.lifeDecrease;
        }

        // Adjust opacity based on life and vertical position
        const heightFactor = Math.max(0, Math.min(1, 
          1 - Math.abs(particle.y - (canvas.height * 0.5)) / (canvas.height * 0.5)
        ));
        // Use the particle's original opacity
        const finalOpacity = particle.initialOpacity * particle.life * heightFactor;
        
        if (particle.life > 0.01) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(255, 255, 255, ${finalOpacity})`;
          ctx.arc(particle.x, particle.y, particle.initialSize, 0, Math.PI * 2);
          ctx.fill();

          // Reset position if off screen
          if (particle.y < -10) {
            // Create completely new particle with current PM2.5 values
            const newParticle = createParticle();
            Object.assign(particle, newParticle);
          }
          if (particle.x > canvas.width + 10) {
            particle.x = -10;
          }

          return true;
        }
        return false;
      });

      frameRef.current = requestAnimationFrame(animate);
    };

    resizeCanvas();
    updateParticleSystem();
    createInitialBurst(); // Add initial burst before starting animation
    animate(0);

    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(frameRef.current);
    };
  }, [devices]);

  // Socket connection setup - remove devices dependency
  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:5000`, {
      transports: ['websocket', 'polling']
    });
    
    socket.on('devices_update', data => {
      handleDeviceUpdate(data);
      currentPM25Ref.current = Math.max(1, ...data.map(d => d.air_quality_value || 0));
    });
    
    return () => socket.disconnect();
  }, [handleDeviceUpdate]); // Only depend on the memoized handler

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      updateTimeoutsRef.current.forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, []);

  return (
    <div className="dashboard">
      <canvas 
        ref={canvasRef} 
        className="particles-canvas"
      />
      <h1 className="title">Levoit Air Purifier Status</h1>
      {devices.length === 0 ? (
        <div className="device-card" style={{"--index": 0}}>
          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: 'var(--text-secondary)',
            fontSize: '1.1rem'
          }}>
            <div style={{
              fontSize: '2rem',
              marginBottom: '1rem',
              background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              No devices found
            </div>
            Searching for connected air purifiers...
          </div>
        </div>
      ) : (
        <div className="devices-grid">
          {devices.map((dev, idx) => (
            <div 
              key={idx} 
              className={`device-card ${updatingDevices.has(idx) ? 'updating' : ''}`}
              style={{"--index": idx}}
            >
              <div 
                className="pm25-display"
                style={{
                  background: `linear-gradient(165deg, 
                    ${getPM25Color(dev.air_quality_value || 0)}15,
                    ${getPM25Color(dev.air_quality_value || 0)}05
                  )`,
                  borderBottom: `1px solid ${getPM25Color(dev.air_quality_value || 0)}30`
                }}
              >
                <div 
                  className="pm25-value"
                  style={{ color: getPM25Color(dev.air_quality_value || 0) }}
                >
                  {dev.air_quality_value || 'N/A'}
                </div>
                <div className="pm25-label">PM2.5</div>
              </div>
              <h3 className="device-name">{dev.name}</h3>
              <div className="status-item">
                <span>Status</span>
                <span className={`status-badge ${dev.is_on ? 'on' : 'off'}`}>
                  {dev.is_on ? 'On' : 'Off'}
                </span>
              </div>
              <div className="status-item">
                <span>Mode</span>
                <span className="mode-badge">{dev.mode || 'N/A'}</span>
              </div>
              <div className="status-item">
                <span>Fan Speed</span>
                <div className="fan-speed">
                  {[1, 2, 3, 4].map(level => (
                    <div
                      key={level}
                      className={`speed-bar ${level <= dev.fan_speed ? 'active' : ''}`}
                      style={{ height: `${level * 5}px` }}
                    />
                  ))}
                </div>
              </div>
              <div className="status-item">
                <span>Air Quality</span>
                <span 
                  className="air-quality-indicator"
                  style={{
                    color: getAirQualityColor(dev.air_quality),
                    background: `${getAirQualityColor(dev.air_quality)}15`,
                    borderColor: `${getAirQualityColor(dev.air_quality)}30`
                  }}
                >
                  {['Excellent', 'Good', 'Fair', 'Poor'][dev.air_quality - 1] || 'N/A'}
                </span>
              </div>
              <div className="status-item">
                <span>Filter Life</span>
                <div className="filter-life">
                  <div 
                    className="filter-life-circle" 
                    style={{"--percent": dev.filter_life || 0}}
                  />
                  <span className="filter-life-text">
                    {dev.filter_life ? `${dev.filter_life}%` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;