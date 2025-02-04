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
  }, []); // Can keep empty deps since we use refs

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
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

    // Modified createParticle to clamp scale for high PM2.5 values
    const createParticle = () => {
      const effectivePM25 = currentPM25Ref.current + 10;
      let scale = Math.pow(effectivePM25 / 35, 1.5) * 1.2;
      // Further clamp scale to 1.8 to reduce particle size at high PM2.5 values
      scale = Math.min(scale, 1.8);
      // Generate particle from a random edge
      const edge = Math.floor(Math.random() * 4);
      let x, y;
      const canvasWidth = canvasRef.current.width;
      const canvasHeight = canvasRef.current.height;
      if (edge === 0) {        // top edge
        x = Math.random() * canvasWidth;
        y = -10;
      } else if (edge === 1) { // right edge
        x = canvasWidth + 10;
        y = Math.random() * canvasHeight;
      } else if (edge === 2) { // bottom edge
        x = Math.random() * canvasWidth;
        y = canvasHeight + 10;
      } else {                 // left edge
        x = -10;
        y = Math.random() * canvasHeight;
      }
      return {
        x,
        y,
        z: Math.random() * 600,
        // Increase the initial size coefficient for larger particles
        initialSize: 0.6 + (Math.random() * 2.5 * scale),
        initialSpeedY: (-0.1 - Math.random() * 0.3) * (1 + scale),
        initialSpeedX: (0.05 + Math.random() * 0.2) * (1 + scale * 0.5),
        initialSpeedZ: (Math.random() * 0.2 - 0.1) * (1 + scale),
        initialOpacity: (0.1 + Math.random() * 0.3) * (1 + scale * 0.7),
        life: 1.0,
        lifeDecrease: 0.0001 + Math.random() * 0.0001,
        angle: Math.random() * Math.PI * 2,
        angularSpeed: 0.01 + Math.random() * 0.02,
        swirlAmplitude: 5 + Math.random() * 5,
        fadeStart: null // new property to track when fading starts
      };
    };

    // Update particle system parameters
    const updateParticleSystem = () => {
      // Increase effective base by adding 10 as offset
      const baseScale = (currentPM25Ref.current + 15) / 15;
      const scale = Math.pow(baseScale, 0.4) * (1 + Math.log10(baseScale + 0.5) * 3);
      
      const baseCount = 500;  // Reduced base count
      const maxCount = 20000;  // Increased from 800
      
      // Multiply the target count factor to spawn many more particles
      particleSystemRef.current.targetCount = 5 * Math.floor(baseCount + (maxCount - baseCount) * scale);
      // Increase spawn rate aggressively at higher values
      particleSystemRef.current.spawnRate = 2 + Math.floor(scale * 30); // More aggressive spawn rate scaling
    };

    const animate = (timestamp) => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const fadeCircle = 300; // invisible circle radius to trigger fade
      const fadeDuration = 1000; // fade out duration in ms
      const attractionFactor = 0.00375;

      // Smoothly update currentPM25 toward targetPM25
      currentPM25Ref.current += (targetPM25Ref.current - currentPM25Ref.current) * 0.02;
      
      // Update particle system parameters each frame
      updateParticleSystem();

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      
      // Efficient particle spawning using a while loop
      const spawnInterval = 1000 / particleSystemRef.current.spawnRate;
      while (
        timestamp - particleSystemRef.current.lastSpawn > spawnInterval &&
        particlesRef.current.length < particleSystemRef.current.targetCount
      ) {
        particlesRef.current.push(createParticle());
        particleSystemRef.current.lastSpawn += spawnInterval;
      }
      
      // Efficient update loop: accumulate active particles in a new array
      const newParticles = [];
      for (let i = 0; i < particlesRef.current.length; i++) {
        const particle = particlesRef.current[i];
        // Update position and apply attraction
        particle.y += particle.initialSpeedY;
        particle.x += particle.initialSpeedX + (centerX - particle.x) * attractionFactor;
        particle.z += particle.initialSpeedZ;
        particle.angle += particle.angularSpeed;
        
        const swirlOffsetX = particle.swirlAmplitude * Math.cos(particle.angle);
        const swirlOffsetY = particle.swirlAmplitude * Math.sin(particle.angle);
        const drawX = particle.x + swirlOffsetX;
        const drawY = particle.y + swirlOffsetY;
        const distance = Math.hypot(drawX - centerX, drawY - centerY);
        let fadeFactor = 1;
        if (distance < fadeCircle) {
          if (!particle.fadeStart) {
            particle.fadeStart = timestamp;
          }
          fadeFactor = 1 - ((timestamp - particle.fadeStart) / fadeDuration);
          fadeFactor = fadeFactor < 0 ? 0 : fadeFactor;
        } else {
          particle.fadeStart = null;
        }
        const heightFactor = Math.max(0, Math.min(1, 1 - Math.abs(particle.y - (canvasHeight * 0.5)) / (canvasHeight * 0.5)));
        const scaleFactor = perspective / (perspective + particle.z);
        const finalOpacity = particle.initialOpacity * particle.life * heightFactor * scaleFactor * fadeFactor;
        const radius = 2 * particle.initialSize * scaleFactor;
        
        if (!isFinite(drawX) || !isFinite(drawY) || !isFinite(radius)) {
          continue; // skip invalid particle
        }
        
        if (finalOpacity !== 0 && particle.life > 0 && (particle.y > -10 && particle.z >= 0 && particle.z <= 600)) {
          ctx.globalAlpha = finalOpacity;
          const drawSize = radius * 2.5;
          ctx.drawImage(canvas.particleImage, drawX - radius, drawY - radius, drawSize, drawSize);
          ctx.globalAlpha = 1;
          // Reset particle if it goes above canvas or fully faded
          if (particle.y < -10 || finalOpacity === 0) {
            newParticles.push(createParticle());
          } else {
            if (particle.x > canvasWidth + 10) {
              particle.x = -10;
            }
            newParticles.push(particle);
          }
        }
        // Else: omit particle (cull it)
      }
      particlesRef.current = newParticles;
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

    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
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
      //   device.air_quality_value = Math.floor(Math.random() * 100) + 1;
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