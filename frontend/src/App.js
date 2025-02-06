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
  const [isLoaded, setIsLoaded] = useState(false);
  const animatingDevicesRef = useRef(new Set());
  const updateTimeoutsRef = useRef([]);
  // Add new ref to store current PM2.5 value
  const currentPM25Ref = useRef(0);
  const targetPM25Ref = useRef(1); // new ref for smooth interpolation
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
    if (!isLoaded) {
      setTimeout(() => setIsLoaded(true), 500); // slight delay for splash fade
    }
  }, [isLoaded]); // Can keep empty deps since we use refs

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    // Detect if mobile
    const isMobile = window.innerWidth < 768;
    let animationFrameId;
    const perspective = 800; // new constant for 3D perspective

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Create or update the cached particle image whenever canvas resizes
      const particleCanvas = document.createElement('canvas');
      const particleCtx = particleCanvas.getContext('2d');
      const particleSize = 64; // cached image fixed size
      particleCanvas.width = particleSize;
      particleCanvas.height = particleSize;
      const grad = particleCtx.createRadialGradient(
        particleSize / 2, particleSize / 2, 0,
        particleSize / 2, particleSize / 2, particleSize / 2
      );
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.8)');
      grad.addColorStop(0.7, 'rgba(14, 165, 233, 0.3)');
      grad.addColorStop(1, 'rgba(14, 165, 233, 0)');
      particleCtx.fillStyle = grad;
      particleCtx.fillRect(0, 0, particleSize, particleSize);
      // Store in ref for use in animate
      canvas.particleImage = particleCanvas;
    };

    // Removed initial burst functions: createInitialParticle and createInitialBurst

    // Replace createParticle function with a realistic physics version
    const createParticle = () => {
      const canvasWidth = canvasRef.current.width;
      const canvasHeight = canvasRef.current.height;
      // Spawn particle from one of four edges uniformly
      const edge = Math.floor(Math.random() * 4);
      let x, y;
      switch (edge) {
        case 0: // top
          x = Math.random() * canvasWidth;
          y = -10;
          break;
        case 1: // right
          x = canvasWidth + 10;
          y = Math.random() * canvasHeight;
          break;
        case 2: // bottom
          x = Math.random() * canvasWidth;
          y = canvasHeight + 10;
          break;
        case 3: // left
          x = -10;
          y = Math.random() * canvasHeight;
          break;
      }
      return {
        x,
        y,
        vx: (Math.random() - 0.5) * 1.0,
        vy: (Math.random() - 0.5) * 1.0,
        opacity: 0.5 + Math.random() * 0.5, // base opacity between 0.5 and 1
        life: 1.0,
        lifeDecrease: 0.001 + Math.random() * 0.002,
        size: 2 + Math.random() * 3 // particle size between 2 and 5
      };
    };

    // Replace updateParticleSystem function with the following:
    const updateParticleSystem = () => {
      // Use target PM2.5 value (which is updated from socket) to adjust spawn rate radically.
      // For example, for pm25=1 spawnRate=5, for pm25=100 spawnRate ~500.
      const pmVal = targetPM25Ref.current;
      const minRate = 10;
      const maxRate = 500;
      // Use a quadratic scaling
      const newSpawnRate = Math.min(maxRate, minRate * Math.pow(pmVal, 2));
      particleSystemRef.current.spawnRate = newSpawnRate;
      // Adjust target count as well, e.g. factor of 6.
      particleSystemRef.current.targetCount = newSpawnRate * 6;
    };

    // In the animate function, replace the physics with a single gravitational acceleration
    const animate = (timestamp) => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      // Updated gravitational constant: toned down by 25%
      const gravityConst = 0.0375;
      const friction = 0.99;
      const nearRadius = 40; // new threshold to disable extra acceleration near center

      // Smoothly update currentPM25 toward targetPM25 (if still needed for spawning rate)
      currentPM25Ref.current += (targetPM25Ref.current - currentPM25Ref.current) * 0.02;
      
      // Update particle system parameters based on current PM2.5 value
      updateParticleSystem();
      
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      
      // Particle spawning using the dynamically computed spawnRate
      const spawnInterval = 1000 / particleSystemRef.current.spawnRate;
      while (
        timestamp - particleSystemRef.current.lastSpawn > spawnInterval &&
        particlesRef.current.length < particleSystemRef.current.targetCount
      ) {
        particlesRef.current.push(createParticle());
        particleSystemRef.current.lastSpawn += spawnInterval;
      }
      
      // Replace filtering with a reverse for-loop to update particles in-place
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const particle = particlesRef.current[i];
        
        // Calculate normalized gravitational acceleration toward center
        let dx = centerX - particle.x;
        let dy = centerY - particle.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) dist = 1;
        
        let ax = 0, ay = 0;
        if (dist > nearRadius) {
          ax = gravityConst * (dx / dist);
          ay = gravityConst * (dy / dist);
        }
        
        // Update velocity, position, and apply friction
        particle.vx = (particle.vx + ax) * friction;
        particle.vy = (particle.vy + ay) * friction;
        particle.x += particle.vx;
        particle.y += particle.vy;
        
        // Adjust fading near center and decrease life
        let fadeFactor = (dist < nearRadius) ? (dist / nearRadius) : 1;
        if (dist < nearRadius) particle.life -= 0.05;
        particle.life -= particle.lifeDecrease;
        const finalOpacity = particle.opacity * Math.max(particle.life, 0) * fadeFactor;
        
        ctx.globalAlpha = finalOpacity;
        const drawSize = particle.size;
        ctx.drawImage(canvas.particleImage, particle.x - drawSize / 2, particle.y - drawSize / 2, drawSize, drawSize);
        ctx.globalAlpha = 1;
        
        // Remove particle if failed criteria
        if (!(particle.life > 0 && particle.x > -50 && particle.x < canvasWidth + 50 && particle.y > -50 && particle.y < canvasHeight + 50)) {
          particlesRef.current.splice(i, 1);
        }
      }
      
      frameRef.current = requestAnimationFrame(animate);
    };

    resizeCanvas();
    updateParticleSystem();

    // Add listener to handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
      } else {
        // Reset lastSpawn to prevent a burst of particles on resume
        particleSystemRef.current.lastSpawn = performance.now();
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    animate(0);

    let resizeTimer;
    const debouncedResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeCanvas, 100);
    };
    window.addEventListener('resize', debouncedResize);

    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelAnimationFrame(frameRef.current);
    };
  }, [devices]);

  // Socket connection setup - remove devices dependency
  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:5000`, {
      transports: ['websocket', 'polling']
    });
    
    socket.on('devices_update', data => {
      // for testing purposes, let's modify and set each device's pm2.5 value to a random 1-100 value
      // we will modify the data object directly
      // data.forEach(device => {
      //   device.air_quality_value = Math.floor(Math.random() * 30) + 1;
      // });

      handleDeviceUpdate(data);
      // Update target PM2.5 rather than current directly
      targetPM25Ref.current = Math.max(1, ...data.map(d => d.air_quality_value || 0));
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

  // Compute cleanliness class based on max PM2.5 value
  const cleanlinessClass = React.useMemo(() => {
    const maxPM25 = devices.reduce((max, d) => Math.max(max, d.air_quality_value || 0), 0);
    if (maxPM25 > 50) return 'dusty';
    if (maxPM25 > 20) return 'almost-clean';
    return 'clean';
  }, [devices]);

  // Compute grid style and whether to use expanded view on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const isExpanded = isMobile && devices.length <= 3;
  const gridStyle = isExpanded ? { gridTemplateColumns: '1fr' } : {};

  return (
    <>
      {!isLoaded && (
        <div className="splash">
          <div className="spinner"></div>
        </div>
      )}
      <div className={`dashboard ${cleanlinessClass}`}>
        <canvas 
          ref={canvasRef} 
          className="particles-canvas"
        />
        <h1 className="title">Levoit Air Purifier Insights</h1>
        {devices.length === 0 ? (
          <div className="loading">
            <div className="spinner"></div>
            <p style={{ textAlign: 'center', marginTop: '1rem', color: '#eef2ff' }}>
              No devices found. Searching...
            </p>
          </div>
        ) : (
          <div className="devices-grid" style={gridStyle}>
            {devices.map((dev, idx) => (
              <div 
                key={idx} 
                className={`device-card ${updatingDevices.has(idx) ? 'updating' : ''} ${isExpanded ? 'expanded' : ''}`}
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
    </>
  );
}

export default App;