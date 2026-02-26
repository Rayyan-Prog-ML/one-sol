
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Scene, AspectRatio, ProcessingStatus } from '../types';

interface PlayerProps {
  audioUrl: string | null;
  scenes: Scene[];
  aspectRatio: AspectRatio;
  videoTitle?: string;
  onTimeUpdate: (time: number) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  backgroundAudioFile: File | null;
  backgroundVolume: number;
  enableBackgroundMusic: boolean;
  enableEmbers: boolean;
  kenBurnsStrength: number;
  filmGrainStrength: number;
  enableVaporOverlay: boolean;
  vaporOverlayFile: File | null;
  vaporOverlayOpacity: number;
  enableLetterboxing: boolean;
  enablePolygonAssembly: boolean;
  triggerAutoExport: boolean;
  onExportStarted: () => void;
  onExportComplete: () => void;
  isBatchMode: boolean;
  fullScript: string;
}

const TRANSITION_DURATION = 1.0; // Increased for dramatic effect
const EXPORT_FPS = 30; 
const EXPORT_BITRATE = 15000000;

const Player: React.FC<PlayerProps> = ({ 
  audioUrl, 
  scenes, 
  aspectRatio,
  videoTitle,
  onTimeUpdate,
  setProcessingStatus,
  backgroundAudioFile,
  backgroundVolume,
  enableBackgroundMusic,
  enableEmbers,
  kenBurnsStrength,
  filmGrainStrength,
  enableVaporOverlay,
  vaporOverlayFile,
  vaporOverlayOpacity,
  enableLetterboxing,
  enablePolygonAssembly,
  onExportStarted,
  onExportComplete,
}) => {
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement>(null); 
  const vaporVideoRef = useRef<HTMLVideoElement>(null); 
  
  const video1 = useRef<HTMLVideoElement>(null); 
  const video2 = useRef<HTMLVideoElement>(null);

  const animationFrameRef = useRef<number>(0);
  const recordedChunks = useRef<Blob[]>([]);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const particlesRef = useRef<any[]>([]);
  const grainCacheRef = useRef<HTMLCanvasElement | null>(null);
  
  const isExportingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const lastActiveSceneId = useRef<string | null>(null);

  const getDimensions = () => {
    switch (aspectRatio) {
      case '9:16': return { width: 720, height: 1280 };
      case '1:1': return { width: 720, height: 720 };
      case '16:9': 
      default: return { width: 1280, height: 720 };
    }
  };

  const { width, height } = getDimensions();

  useEffect(() => {
    const grainCanvas = document.createElement('canvas');
    grainCanvas.width = 256; 
    grainCanvas.height = 256;
    const gctx = grainCanvas.getContext('2d');
    if (gctx) {
      const imageData = gctx.createImageData(256, 256);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const val = Math.random() * 255;
        imageData.data[i] = val;
        imageData.data[i+1] = val;
        imageData.data[i+2] = val;
        imageData.data[i+3] = 255;
      }
      gctx.putImageData(imageData, 0, 0);
      grainCacheRef.current = grainCanvas;
    }
  }, []);

  useEffect(() => {
    scenes.forEach(scene => {
      if (scene.imageUrl && !imageCache.current.has(scene.imageUrl)) {
        const img = new Image();
        img.src = scene.imageUrl;
        img.onload = () => { imageCache.current.set(scene.imageUrl!, img); };
      }
    });
  }, [scenes]);

  const drawMediaToCanvas = (ctx: CanvasRenderingContext2D, media: HTMLImageElement | HTMLVideoElement, scale: number = 1, opacity: number = 1, xOffset: number = 0, yOffset: number = 0) => {
    const mWidth = media instanceof HTMLImageElement ? media.width : (media as HTMLVideoElement).videoWidth;
    const mHeight = media instanceof HTMLImageElement ? media.height : (media as HTMLVideoElement).videoHeight;
    if (mWidth === 0 || mHeight === 0) return;

    const baseScale = Math.max(width / mWidth, height / mHeight);
    const finalScale = baseScale * scale;
    const drawWidth = mWidth * finalScale;
    const drawHeight = mHeight * finalScale;
    
    // Center anchor
    const x = (width - drawWidth) / 2 + xOffset;
    const y = (height - drawHeight) / 2 + yOffset;
    
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(media, x, y, drawWidth, drawHeight);
    ctx.restore();
  };

  /**
   * VELOCITY-SYNC RENDERING
   * Adjusts playbackRate to catch up rather than seeking (which causes stutter).
   */
  const renderSceneFrame = (ctx: CanvasRenderingContext2D, scene: Scene, time: number, transitionProgress: number, isOutgoing: boolean) => {
      ctx.save();
      
      const sceneDuration = scene.endTime - scene.startTime;
      const elapsed = time - scene.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / sceneDuration));

      // Determine visual parameters based on style and transition
      let scale = 1.0;
      let opacity = 1.0;
      let xOffset = 0;
      let yOffset = 0;

      // Parallax 2.5D (S-curve easing)
      if (scene.transitionType === 'parallax-2.5d' || kenBurnsStrength > 0) {
          const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress; // Ease-in-out
          scale = 1.0 + (kenBurnsStrength * 0.15) + (ease * 0.05); // Subtle zoom
          // Slight pan based on hash of ID to be deterministic but random-looking
          const seed = scene.id.charCodeAt(scene.id.length - 1) % 2 === 0 ? 1 : -1;
          xOffset = (ease * 20 * seed); 
      }

      // Transition Logic
      if (isOutgoing) {
          // This is the PREVIOUS scene fading out
          if (scene.transitionType === 'zoom-through') {
              // Massive zoom in and fade out
              scale *= (1 + transitionProgress * 4); // Zoom to 5x
              opacity = 1 - transitionProgress;
          } else if (scene.transitionType === 'polygon-wipe') {
              // Stay static, will be covered by next scene
              opacity = 1.0; 
          } else {
              // Standard fade
              opacity = 1 - transitionProgress;
          }
      } else {
          // This is the ACTIVE scene fading in
          if (scene.transitionType === 'zoom-through') {
              // Start slightly zoomed out or normal
              opacity = transitionProgress;
          } else if (scene.transitionType === 'polygon-wipe') {
              // Clip path logic
              opacity = 1.0;
              const p = transitionProgress;
              ctx.beginPath();
              // Hexagonal wipe from center
              const size = Math.max(width, height) * p * 1.5;
              for (let i = 0; i < 6; i++) {
                  const angle = (i * Math.PI) / 3;
                  const x = width/2 + size * Math.cos(angle);
                  const y = height/2 + size * Math.sin(angle);
                  if (i === 0) ctx.moveTo(x, y);
                  else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.clip();
          } else {
              // Standard fade
              opacity = transitionProgress;
          }
      }

      // Polygon Assembly Effect (Entrance)
      if (enablePolygonAssembly && !isOutgoing && elapsed < 1.0) {
          // Draw random "assembling" triangles
          const count = Math.floor(20 * (1.0 - elapsed));
          ctx.save();
          ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * (1.0 - elapsed)})`;
          for(let i=0; i<count; i++) {
              ctx.beginPath();
              const x = Math.random() * width;
              const y = Math.random() * height;
              const s = Math.random() * 150;
              ctx.moveTo(x, y);
              ctx.lineTo(x + s, y + s);
              ctx.lineTo(x - s, y + s);
              ctx.fill();
          }
          ctx.restore();
      }

      // Layer 1: Persistent Image (Safety Net)
      if (scene.imageUrl && imageCache.current.has(scene.imageUrl)) {
          drawMediaToCanvas(ctx, imageCache.current.get(scene.imageUrl)!, scale, opacity, xOffset, yOffset);
      }

      // Layer 2: Video with Dynamic Sync
      const v = (video1.current?.src === scene.videoClipUrl) ? video1.current : 
                (video2.current?.src === scene.videoClipUrl) ? video2.current : null;

      if (scene.videoClipUrl && v && v.readyState >= 2) {
          const baseRate = (v.duration || sceneDuration) / sceneDuration;
          const targetTime = elapsed * baseRate;
          const drift = v.currentTime - targetTime;

          if (Math.abs(drift) > 0.5) {
              v.currentTime = targetTime;
          } else if (Math.abs(drift) > 0.05) {
              v.playbackRate = drift > 0 ? baseRate * 0.95 : baseRate * 1.05;
          } else {
              v.playbackRate = baseRate;
          }
          
          if (isPlaying && v.paused) v.play().catch(() => {});
          drawMediaToCanvas(ctx, v, scale, opacity, xOffset, yOffset);
      } 
      
      ctx.restore();
  };

  const draw = useCallback(() => {
    const canvas = videoCanvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || isExporting) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    
    const currentTime = audio.currentTime;
    onTimeUpdate(currentTime);

    const idx = scenes.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);
    const activeScene = scenes[idx];

    // Predictive Pre-loading logic
    if (activeScene && activeScene.id !== lastActiveSceneId.current) {
        lastActiveSceneId.current = activeScene.id;
        
        // Find which node to use for next scene
        const v1Match = video1.current?.src === activeScene.videoClipUrl;
        const v2Match = video2.current?.src === activeScene.videoClipUrl;
        
        if (!v1Match && !v2Match && activeScene.videoClipUrl) {
            const nextV = video1.current?.paused ? video1.current : video2.current;
            if (nextV) {
                nextV.src = activeScene.videoClipUrl;
                nextV.load();
                nextV.currentTime = 0; // Pre-seek to start
            }
        }
    }

    if (!activeScene || (!activeScene.imageUrl && !activeScene.videoClipUrl)) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
    }

    if (activeScene) {
      const tIn = currentTime - activeScene.startTime;
      
      // Clear background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      if (idx > 0 && tIn < TRANSITION_DURATION) {
          // Transition Phase
          const prevScene = scenes[idx - 1];
          const transitionProgress = tIn / TRANSITION_DURATION;
          
          // Draw outgoing scene (bottom layer usually, unless zoom-through)
          renderSceneFrame(ctx, prevScene, currentTime, transitionProgress, true);
          
          // Draw incoming scene (top layer)
          renderSceneFrame(ctx, activeScene, currentTime, transitionProgress, false);
      } else {
          // Stable Phase
          renderSceneFrame(ctx, activeScene, currentTime, 1.0, false);
      }
    }

    if (enableEmbers) updateParticles(ctx);
    if (enableVaporOverlay && vaporVideoRef.current && vaporVideoRef.current.readyState >= 2) {
        ctx.save();
        ctx.globalAlpha = vaporOverlayOpacity;
        ctx.globalCompositeOperation = 'screen'; 
        ctx.drawImage(vaporVideoRef.current, 0, 0, width, height);
        ctx.restore();
    }
    if (filmGrainStrength > 0) drawFilmGrain(ctx);

    // Cinematic Letterboxing
    if (enableLetterboxing) {
        const barHeight = height * 0.1; // 10% bars
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, barHeight);
        ctx.fillRect(0, height - barHeight, width, barHeight);
    }

    if (!audio.paused && !audio.ended) {
      animationFrameRef.current = requestAnimationFrame(draw);
    } else {
      setIsPlaying(false);
      video1.current?.pause();
      video2.current?.pause();
    }
  }, [scenes, width, height, isExporting, isPlaying, enableEmbers, filmGrainStrength, enableVaporOverlay, vaporOverlayOpacity, enableLetterboxing, enablePolygonAssembly]);

  const updateParticles = (ctx: CanvasRenderingContext2D, isDeterministic: boolean = false) => {
    if (!enableEmbers) { particlesRef.current = []; return; }
    if (particlesRef.current.length < 50 && (isDeterministic || Math.random() > 0.6)) {
         particlesRef.current.push({
             x: Math.random() * width, y: height + 10,
             vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 2.5 - 0.8,
             size: Math.random() * 2.0 + 0.5, life: 180,
             color: `rgba(255, ${Math.floor(Math.random() * 100) + 120}, 40,`
         });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx; p.y += p.vy; p.life--;
        const alpha = Math.min(0.7, p.life / 60);
        ctx.fillStyle = `${p.color} ${alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0 || p.y < -20) particlesRef.current.splice(i, 1);
    }
    ctx.restore();
  };

  const drawFilmGrain = (ctx: CanvasRenderingContext2D) => {
    if (!grainCacheRef.current) return;
    ctx.save();
    ctx.globalAlpha = filmGrainStrength * 0.15;
    ctx.globalCompositeOperation = 'overlay';
    const ptrn = ctx.createPattern(grainCacheRef.current, 'repeat');
    if (ptrn) {
      ctx.translate(Math.random() * 256, Math.random() * 256);
      ctx.fillStyle = ptrn;
      ctx.fillRect(-256, -256, width + 512, height + 512);
    }
    ctx.restore();
  };

  useEffect(() => {
    if (isPlaying) draw();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, draw]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        bgAudioRef.current?.pause();
        vaporVideoRef.current?.pause();
        video1.current?.pause();
        video2.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        if (enableBackgroundMusic) bgAudioRef.current?.play();
        if (enableVaporOverlay) vaporVideoRef.current?.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  const handleExport = async () => {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setIsExporting(true);
    onExportStarted();

    setProcessingStatus({ step: 'exporting', progress: 5, message: 'Warming Master Render Engine...' });

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
      const dest = audioCtx.createMediaStreamDestination();
      
      const response = await fetch(audioUrl!);
      const mainBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
      const mainSource = audioCtx.createBufferSource();
      mainSource.buffer = mainBuffer;
      mainSource.connect(dest);

      const canvasStream = videoCanvasRef.current!.captureStream(EXPORT_FPS); 
      const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const recorder = new MediaRecorder(combinedStream, { 
          mimeType: 'video/webm;codecs=vp9', 
          videoBitsPerSecond: EXPORT_BITRATE 
      });
      
      recordedChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.current.push(e.data); };
      
      recorder.onstop = () => {
        const videoBlob = new Blob(recordedChunks.current, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(videoBlob);
        a.download = `${videoTitle || 'master_production'}.webm`;
        a.click();
        setIsExporting(false);
        isExportingRef.current = false;
        onExportComplete();
        audioCtx.close();
      };

      recorder.start();
      mainSource.start(0);

      const totalT = mainBuffer.duration;
      const startT = audioCtx.currentTime;

      const exportLoop = () => {
        if (!isExportingRef.current) return;

        const ctx = videoCanvasRef.current?.getContext('2d');
        if (ctx) {
          const currentT = audioCtx.currentTime - startT;
          const idx = scenes.findIndex(s => currentT >= s.startTime && currentT < s.endTime);
          const s = scenes[idx];

          if (!s || (!s.imageUrl && !s.videoClipUrl)) {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, width, height);
          }

          if (s) {
            if (s.id !== lastActiveSceneId.current) {
                lastActiveSceneId.current = s.id;
                const v1Match = video1.current?.src === s.videoClipUrl;
                const v2Match = video2.current?.src === s.videoClipUrl;
                if (!v1Match && !v2Match && s.videoClipUrl) {
                    const nextV = video1.current?.paused ? video1.current : video2.current;
                    if (nextV) { nextV.src = s.videoClipUrl; nextV.load(); nextV.currentTime = 0; }
                }
            }

            const tIn = currentT - s.startTime;
            if (idx > 0 && tIn < TRANSITION_DURATION) {
              renderSceneFrame(ctx, scenes[idx-1], currentT, tIn/TRANSITION_DURATION, true);
              renderSceneFrame(ctx, s, currentT, tIn/TRANSITION_DURATION, false);
            } else {
              renderSceneFrame(ctx, s, currentT, 1.0, false);
            }
          }

          if (enableEmbers) updateParticles(ctx, true);
          if (filmGrainStrength > 0) drawFilmGrain(ctx);
          
          setProcessingStatus({ 
            step: 'exporting', progress: Math.min(99, Math.round((currentT/totalT)*100)), 
            message: `Seamless Export: Part ${idx+1}/${scenes.length}` 
          });

          if (currentT < totalT) {
            requestAnimationFrame(exportLoop);
          } else {
            recorder.stop();
          }
        }
      };
      
      exportLoop();
    } catch (e) { 
        setIsExporting(false); 
        isExportingRef.current = false;
        setProcessingStatus({ step: 'idle', progress: 0, message: 'Export engine crash.' });
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative rounded-2xl overflow-hidden shadow-2xl border-2 border-gray-800 bg-black group transition-all duration-500 hover:border-brand-500/50">
        <canvas ref={videoCanvasRef} width={width} height={height} className="max-w-full h-auto cursor-pointer" onClick={togglePlay} />
        {!isPlaying && !isExporting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none group-hover:bg-black/30 transition-all">
                <div className="w-20 h-20 rounded-full bg-brand-500/90 flex items-center justify-center text-white text-3xl shadow-2xl backdrop-blur-md border border-white/20 transform group-hover:scale-110 transition-transform">▶</div>
            </div>
        )}
      </div>
      <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, overflow: 'hidden' }}>
        <audio ref={audioRef} src={audioUrl || undefined} />
        <audio ref={bgAudioRef} />
        <video ref={vaporVideoRef} playsInline muted loop preload="auto" />
        <video ref={video1} playsInline muted preload="auto" />
        <video ref={video2} playsInline muted preload="auto" />
      </div>
      <div className="flex gap-4">
        <button onClick={togglePlay} className="px-12 py-4 rounded-full font-bold bg-brand-600 text-white shadow-xl hover:bg-brand-500 transition-all active:scale-95 flex items-center gap-2">
          {isPlaying ? 'PAUSE' : 'PREVIEW'}
        </button>
        <button onClick={handleExport} disabled={isExporting || scenes.length === 0} className="px-12 py-4 rounded-full font-bold bg-emerald-600 text-white disabled:opacity-50 shadow-xl hover:bg-emerald-500 transition-all active:scale-95">
          {isExporting ? 'EXPORTING...' : 'DOWNLOAD HD MP4'}
        </button>
      </div>
    </div>
  );
};

export default Player;
