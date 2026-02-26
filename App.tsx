
import React, { useState, useEffect, useRef } from 'react';
import { Scene, ProjectState, ProcessingStatus } from './types';
import { 
  generateScenes, 
  generateImagePrompts, 
  generateVideoPrompts, 
  generateImageForScene, 
  generateStoryOutline, 
  generateStoryChapter, 
  generateVoiceOver, 
  generateOpenAIVoiceOver,
  OPENAI_VOICES,
  OpenAIVoice,
  verifyApiKeys, 
  masterAuditScript, 
  trimSilenceFromAudio,
  STYLE_RECIPES, 
  SAFETY_BLOCK 
} from './services/geminiService';
import Timeline from './components/Timeline';
import Player from './components/Player';
import { Download, Zap } from 'lucide-react';

const App: React.FC = () => {
  const [project, setProject] = useState<ProjectState>({
    videoTitle: '', audioFile: null, audioDuration: 0, scriptText: '', scenes: [], aspectRatio: '16:9',
    backgroundAudioFile: null, backgroundVolume: 0.05, enableBackgroundMusic: false, enableEmbers: true, 
    kenBurnsStrength: 0.6, filmGrainStrength: 0.2, enableVaporOverlay: false,
    vaporOverlayFile: null, vaporOverlayOpacity: 0.5, 
    enableLetterboxing: true, enablePolygonAssembly: true,
    generatedMetadata: null, viralWordsCandidates: [],
    selectedViralWord: null, generatedThumbnails: [],
    thumbnailStudio: { isOpen: false, referenceImages: [], analyzedStyles: [], customTitle: '', generatedImage: null, isAnalyzing: false, isGenerating: false },
    visualStage: 'idle'
  });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({ step: 'idle', progress: 0, message: '' });
  const [apiKeys, setApiKeys] = useState({ gemini: false, nvidia: false, openai: false });
  const [selectedVoice, setSelectedVoice] = useState<OpenAIVoice>('onyx');
  
  const [showScriptWizard, setShowScriptWizard] = useState(false);
  const [wizardTopic, setWizardTopic] = useState('');
  const [previewScene, setPreviewScene] = useState<Scene | null>(null);
  
  const audioInputRef = useRef<HTMLInputElement>(null);
  const bulkImageInputRef = useRef<HTMLInputElement>(null);
  const bulkVideoInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    verifyApiKeys().then(keys => setApiKeys(keys));
  }, []);

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setStatus({ step: 'refining', progress: 10, message: 'Processing & Trimming Silence...' });
    try {
        const cleanedBlob = await trimSilenceFromAudio(file);
        const cleanedFile = new File([cleanedBlob], "cleaned_narration.wav", { type: "audio/wav" });
        const url = URL.createObjectURL(cleanedFile);
        
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          setProject(prev => ({ ...prev, audioFile: cleanedFile, audioDuration: audio.duration }));
          setAudioUrl(url);
          setStatus({ step: 'ready', progress: 100, message: 'Audio Uploaded & Tightened.' });
        };
    } catch (err) {
        setStatus({ step: 'idle', progress: 0, message: 'Audio Processing Failed.' });
    }
  };

  const handleOverlayUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setProject(prev => ({ ...prev, vaporOverlayFile: file, enableVaporOverlay: true }));
  };

  const handleAuditScript = async () => {
      if (!project.scriptText) return;
      setStatus({ step: 'refining', progress: 50, message: 'Auditing Viral Script...' });
      try {
          const { auditedScript, changesLog } = await masterAuditScript(project.scriptText, project.videoTitle || wizardTopic || 'Documentary');
          setProject(prev => ({ ...prev, scriptText: auditedScript }));
          alert(`Master Audit Complete!\n\n${changesLog}`);
          setStatus({ step: 'ready', progress: 100, message: 'Audit Applied.' });
      } catch (e) {
          setStatus({ step: 'idle', progress: 0, message: 'Audit Failed.' });
      }
  };

  const handleGenerateVoice = async () => {
      if (!project.scriptText) return null;
      try {
          setStatus({ step: 'refining', progress: 0, message: 'Synthesizing OpenAI Narration...' });
          const cleanedWavBlob = await generateOpenAIVoiceOver(
              project.scriptText, 
              selectedVoice,
              (p, m) => setStatus({ step: 'refining', progress: p, message: m })
          );
          const file = new File([cleanedWavBlob], "master_narration.mp3", { type: "audio/mpeg" });
          const url = URL.createObjectURL(file);
          return new Promise<{url: string, duration: number}>((resolve) => {
              const audio = new Audio(url);
              audio.onloadedmetadata = () => {
                setProject(prev => ({ ...prev, audioFile: file, audioDuration: audio.duration }));
                setAudioUrl(url);
                setStatus({ step: 'ready', progress: 100, message: 'OpenAI Narration Ready.' });
                resolve({url, duration: audio.duration});
              };
          });
      } catch (e) { 
          console.error(e);
          setStatus({ step: 'idle', progress: 0, message: 'OpenAI Synthesis Failed.' }); 
          return null; 
      }
  };

  const handleStartFullProduction = async () => {
      if(!wizardTopic) return;
      setShowScriptWizard(false);
      setStatus({ step: 'refining', progress: 5, message: 'Architecting Landmarks & Stops...' });
      try {
          const chapters = await generateStoryOutline(wizardTopic, 12);
          const fullOutline = chapters.join('\n');
          let rawFullScript = "";
          let previousSummary = "Start";
          for (let i = 0; i < chapters.length; i++) {
              setStatus({ step: 'refining', progress: Math.round(((i + 1) / chapters.length) * 100), message: `Writing Viral Part ${i + 1}/${chapters.length}...` });
              const { content, summary } = await generateStoryChapter(wizardTopic, chapters[i], previousSummary, fullOutline, i + 1, chapters.length);
              rawFullScript += `\n\n${content}`;
              previousSummary = summary;
          }
          const { auditedScript } = await masterAuditScript(rawFullScript, wizardTopic);
          setProject(prev => ({ ...prev, scriptText: auditedScript.trim(), videoTitle: wizardTopic, visualStage: 'idle' }));
          setStatus({ step: 'ready', progress: 100, message: '1,500 Word Script Generated & Audited.' });
      } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Production Error.' }); }
  };

  const runGenerateScenes = async () => {
    if (!project.scriptText) return;
    setStatus({ step: 'generating_scenes', progress: 50, message: 'Analyzing Script for Scenes...' });
    try {
      const audioDur = project.audioDuration || 600;
      const scenes = await generateScenes(project.scriptText, audioDur);
      setProject(prev => ({ ...prev, scenes, visualStage: 'scenes' }));
      setStatus({ step: 'ready', progress: 100, message: `${scenes.length} Scenes Generated.` });
    } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Scene Generation Failed.' }); }
  };

  const runGenerateImagePrompts = async () => {
    if (project.scenes.length === 0) return;
    setStatus({ step: 'generating_image_prompts', progress: 50, message: 'Generating Detailed Image Prompts...' });
    try {
      const prompts = await generateImagePrompts(project.scenes);
      setProject(prev => ({
        ...prev,
        visualStage: 'image_prompts',
        scenes: prev.scenes.map((s, i) => ({ ...s, imagePrompt: prompts[i] || s.visualDescription }))
      }));
      setStatus({ step: 'ready', progress: 100, message: 'Image Prompts Generated.' });
    } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Prompt Generation Failed.' }); }
  };

  const runGenerateVideoPrompts = async () => {
    if (project.scenes.length === 0) return;
    setStatus({ step: 'generating_video_prompts', progress: 50, message: 'Generating Cinematic Video Prompts...' });
    try {
      const prompts = await generateVideoPrompts(project.scenes);
      setProject(prev => ({
        ...prev,
        visualStage: 'video_prompts',
        scenes: prev.scenes.map((s, i) => ({ ...s, videoPrompt: prompts[i] || "Cinematic motion." }))
      }));
      setStatus({ step: 'ready', progress: 100, message: 'Video Prompts Generated.' });
    } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Video Prompt Generation Failed.' }); }
  };

  const handleBulkImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setStatus({ step: 'generating_images', progress: 0, message: `Importing Assets...` });
      const fileList = (Array.from(files) as File[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const imageData: string[] = [];
      for (let i = 0; i < fileList.length; i++) {
          const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(fileList[i]);
          });
          imageData.push(base64);
          if (i % 5 === 0) setStatus({ step: 'generating_images', progress: Math.round(((i + 1) / fileList.length) * 100), message: `Processing Image ${i+1}/${fileList.length}...` });
      }
      setProject(prev => {
          if (prev.scenes.length === 0) { alert("Generate storyboard first."); return prev; }
          
          // Map only to scenes that require 'image' medium
          const imageScenes = prev.scenes.filter(s => s.medium === 'image');
          const updatedScenes = prev.scenes.map((scene) => {
              if (scene.medium === 'image') {
                  const idx = imageScenes.indexOf(scene);
                  if (idx !== -1 && idx < imageData.length) {
                      return { ...scene, imageUrl: imageData[idx] };
                  }
              }
              return scene;
          });
          return { ...prev, scenes: updatedScenes };
      });
      setStatus({ step: 'ready', progress: 100, message: 'Import Complete!' });
  };

  const handleBulkVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setStatus({ step: 'importing_assets', progress: 0, message: `Mapping Video Clips...` });
      const fileList = (Array.from(files) as File[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      setProject(prev => {
          if (prev.scenes.length === 0) { alert("Please generate scenes first."); return prev; }
          
          // Map only to scenes that require 'video' medium
          const videoScenes = prev.scenes.filter(s => s.medium === 'video');
          const updatedScenes = prev.scenes.map((scene) => {
              if (scene.medium === 'video') {
                  const idx = videoScenes.indexOf(scene);
                  if (idx !== -1 && idx < fileList.length) {
                      return { ...scene, videoClipUrl: URL.createObjectURL(fileList[idx]) };
                  }
              }
              return scene;
          });
          return { ...prev, scenes: updatedScenes };
      });
      setStatus({ step: 'ready', progress: 100, message: 'Video Clips Mapped!' });
  };

  const handleUpdateScene = (id: string, updates: Partial<Scene>) => {
    setProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const handleRetryScene = async (sceneId: string, customPrompt: string) => {
    const sceneIdx = project.scenes.findIndex(s => s.id === sceneId);
    if (sceneIdx === -1) return;
    const updatedScenes = [...project.scenes];
    updatedScenes[sceneIdx] = { ...updatedScenes[sceneIdx], isGeneratingImage: true };
    setProject(prev => ({ ...prev, scenes: updatedScenes }));
    try {
      const base64 = await generateImageForScene(customPrompt, project.aspectRatio, project.scenes[sceneIdx].visualStyle);
      handleUpdateScene(sceneId, { imageUrl: base64, isGeneratingImage: false });
    } catch (e) { 
      handleUpdateScene(sceneId, { isGeneratingImage: false });
    }
  };

  const downloadMasterAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${project.videoTitle || 'master'}_narration.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadPrompts = (type: 'image' | 'video') => {
    let content = "";
    const title = project.videoTitle || 'master';
    
    // Filter scenes by medium
    const targetMedium = type === 'image' ? 'image' : 'video';
    const filteredScenes = project.scenes.filter(s => s.medium === targetMedium);

    filteredScenes.forEach((s) => {
      const rawPrompt = type === 'image' ? (s.imagePrompt || s.visualDescription) : (s.videoPrompt || "");
      if (rawPrompt) {
        const cleanPrompt = rawPrompt.replace(/^(\d+[\.\:\)\s-]*|#\d+[\.\:\)\s-]*|Scene\s+\d+[\.\:\)\s-]*)/i, '').trim();
        content += `${cleanPrompt}\n`;
      }
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}_${type}_prompts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const runBatchImageGeneration = async () => {
    const imageScenes = project.scenes.filter(s => s.medium === 'image' && !s.imageUrl);
    if (imageScenes.length === 0) {
      alert("No pending image scenes found.");
      return;
    }

    setStatus({ step: 'generating_images', progress: 0, message: `Starting Batch Generation (${imageScenes.length} images)...` });

    const batchSize = 4;
    const batchInterval = 15000; // 15 seconds
    const interBatchGap = 30000; // 30 seconds

    for (let i = 0; i < imageScenes.length; i += batchSize) {
      const currentBatch = imageScenes.slice(i, i + batchSize);
      setStatus({ 
        step: 'generating_images', 
        progress: Math.round((i / imageScenes.length) * 100), 
        message: `Processing Batch ${Math.floor(i / batchSize) + 1}...` 
      });

      // Process batch in parallel
      await Promise.all(currentBatch.map(async (scene) => {
        try {
          handleUpdateScene(scene.id, { isGeneratingImage: true });
          const base64 = await generateImageForScene(scene.imagePrompt || scene.visualDescription, project.aspectRatio, scene.visualStyle);
          handleUpdateScene(scene.id, { imageUrl: base64, isGeneratingImage: false });
        } catch (err) {
          handleUpdateScene(scene.id, { isGeneratingImage: false });
          console.error(`Failed to generate image for scene ${scene.id}`, err);
        }
      }));

      // Wait between batches
      if (i + batchSize < imageScenes.length) {
        const isNextBatchInSameSet = (Math.floor((i + batchSize) / batchSize) % 2 !== 0);
        const waitTime = isNextBatchInSameSet ? batchInterval : interBatchGap;
        
        for (let seconds = waitTime / 1000; seconds > 0; seconds--) {
          setStatus({ 
            step: 'generating_images', 
            progress: Math.round(((i + batchSize) / imageScenes.length) * 100), 
            message: `Waiting ${seconds}s for next batch...` 
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    setStatus({ step: 'ready', progress: 100, message: 'Batch Image Generation Complete!' });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans overflow-hidden">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-brand-500 flex items-center justify-center font-bold">R</div>
            <h1 className="text-xl font-bold tracking-tight">RMagine <span className="text-brand-400">Master</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-3 bg-gray-950 px-4 py-2 rounded-full border border-gray-800">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${apiKeys.gemini ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">GEMINI</span>
              </div>
              <div className="w-px h-3 bg-gray-800" />
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${apiKeys.nvidia ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">NVIDIA</span>
              </div>
              <div className="w-px h-3 bg-gray-800" />
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${apiKeys.openai ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">OPENAI</span>
              </div>
            </div>
            
            <div className="text-xs text-brand-400 font-mono bg-gray-800/50 px-3 py-1.5 rounded-full border border-gray-700">
                VIRAL PIPELINE ACTIVE
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col lg:flex-row gap-8 overflow-hidden">
        <div className="lg:w-1/3 flex flex-col gap-6 overflow-y-auto h-full pr-2 scrollbar-hide">
          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-brand-400 flex items-center justify-between">
              1. Script & Narration
              {audioUrl && (
                <button onClick={downloadMasterAudio} className="text-[10px] bg-amber-600/20 text-amber-400 px-3 py-1 rounded-full border border-amber-600/50 hover:bg-amber-600 hover:text-white transition-all">
                  DOWNLOAD MASTER AUDIO
                </button>
              )}
            </h2>
            <textarea value={project.scriptText} onChange={(e) => setProject(prev => ({ ...prev, scriptText: e.target.value }))} className="w-full bg-gray-950 border border-gray-800 rounded p-4 text-sm h-48 focus:border-brand-500 outline-none" placeholder="Script will appear here..." />
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Select OpenAI Voice</label>
              <div className="grid grid-cols-3 gap-1">
                {OPENAI_VOICES.map(v => (
                  <button 
                    key={v} 
                    onClick={() => setSelectedVoice(v)}
                    className={`py-1 text-[10px] rounded border transition-all ${selectedVoice === v ? 'bg-brand-600 border-brand-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700'}`}
                  >
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowScriptWizard(true)} className="py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] font-bold transition-all">START DOC WRITER</button>
              <button onClick={() => audioInputRef.current?.click()} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold border border-gray-700 transition-colors">UPLOAD AUDIO</button>
              <input type="file" ref={audioInputRef} className="hidden" accept="audio/*" onChange={handleAudioUpload} />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={handleGenerateVoice} disabled={!project.scriptText} className="py-2 bg-brand-600 hover:bg-brand-500 rounded text-[10px] font-bold disabled:opacity-50">GENERATE AI NARRATION</button>
            </div>
          </section>

          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-amber-400">2. Visual Master Production</h2>
            <div className="flex flex-col gap-3">
                <button 
                  onClick={runGenerateScenes} 
                  disabled={!project.scriptText || project.visualStage !== 'idle'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'idle' ? 'bg-indigo-700 hover:bg-indigo-600' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.scenes.length > 0 ? `Stage 1: ${project.scenes.length} Scenes Created` : "STAGE 1: GENERATE SCENES"}
                </button>

                <button 
                  onClick={runGenerateImagePrompts} 
                  disabled={project.scenes.length === 0 || project.visualStage === 'idle' || project.visualStage === 'video_prompts'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'scenes' ? 'bg-indigo-700 hover:bg-indigo-600' : project.visualStage === 'image_prompts' || project.visualStage === 'video_prompts' ? 'bg-emerald-900 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.visualStage === 'image_prompts' || project.visualStage === 'video_prompts' ? "Stage 2: Image Prompts Ready" : "STAGE 2: GENERATE IMAGE PROMPTS"}
                </button>

                <button 
                  onClick={runGenerateVideoPrompts} 
                  disabled={project.visualStage !== 'image_prompts'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'image_prompts' ? 'bg-indigo-700 hover:bg-indigo-600' : project.visualStage === 'video_prompts' ? 'bg-emerald-900 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.visualStage === 'video_prompts' ? "Stage 3: Video Prompts Ready" : "STAGE 3: GENERATE VIDEO PROMPTS"}
                </button>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={() => downloadPrompts('image')} disabled={project.scenes.length === 0} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-brand-400 flex items-center justify-center gap-1">
                    <Download size={12} /> IMAGE PROMPTS
                  </button>
                  <button onClick={() => downloadPrompts('video')} disabled={project.visualStage !== 'video_prompts'} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-amber-400 flex items-center justify-center gap-1">
                    <Download size={12} /> VIDEO PROMPTS
                  </button>
                </div>
                
                <button 
                  onClick={runBatchImageGeneration} 
                  disabled={project.scenes.length === 0}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[10px] font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2"
                >
                  <Zap size={14} /> BATCH GENERATE IMAGES
                </button>
                
                <div className="pt-2 border-t border-gray-800 flex flex-col gap-2">
                    <button onClick={() => bulkImageInputRef.current?.click()} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold">IMPORT IMAGES</button>
                    <input type="file" ref={bulkImageInputRef} multiple className="hidden" accept="image/*" onChange={handleBulkImageUpload} />
                    
                    <button onClick={() => bulkVideoInputRef.current?.click()} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold">IMPORT VIDEO CLIPS</button>
                    <input type="file" ref={bulkVideoInputRef} multiple className="hidden" accept="video/*" onChange={handleBulkVideoUpload} />
                </div>
            </div>
          </section>

          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Cinematic Overlays</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded border border-gray-800">
                <span className="text-[10px] font-bold text-gray-500">DYNAMIC EMBERS</span>
                <button onClick={() => setProject(p => ({...p, enableEmbers: !p.enableEmbers}))} className={`px-4 py-1 rounded text-[10px] font-bold transition-all ${project.enableEmbers ? 'bg-orange-600' : 'bg-gray-800'}`}>
                    {project.enableEmbers ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded border border-gray-800">
                <span className="text-[10px] font-bold text-gray-500">LETTERBOXING</span>
                <button onClick={() => setProject(p => ({...p, enableLetterboxing: !p.enableLetterboxing}))} className={`px-4 py-1 rounded text-[10px] font-bold transition-all ${project.enableLetterboxing ? 'bg-indigo-600' : 'bg-gray-800'}`}>
                    {project.enableLetterboxing ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded border border-gray-800">
                <span className="text-[10px] font-bold text-gray-500">POLYGON ASSEMBLY</span>
                <button onClick={() => setProject(p => ({...p, enablePolygonAssembly: !p.enablePolygonAssembly}))} className={`px-4 py-1 rounded text-[10px] font-bold transition-all ${project.enablePolygonAssembly ? 'bg-indigo-600' : 'bg-gray-800'}`}>
                    {project.enablePolygonAssembly ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="p-3 bg-gray-950 rounded border border-gray-800 space-y-2">
                <div className="flex justify-between items-center mb-1">
                   <span className="text-[10px] font-bold text-gray-500">VAPOR OVERLAY</span>
                   <button onClick={() => overlayInputRef.current?.click()} className="text-[9px] bg-brand-600 px-2 py-0.5 rounded">UPLOAD</button>
                   <input type="file" ref={overlayInputRef} className="hidden" accept="video/*" onChange={handleOverlayUpload} />
                </div>
                {project.vaporOverlayFile && (
                  <input type="range" min="0" max="1" step="0.05" value={project.vaporOverlayOpacity} onChange={(e) => setProject(p => ({...p, vaporOverlayOpacity: parseFloat(e.target.value)}))} className="w-full h-1 accent-brand-500" />
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:w-2/3 flex flex-col gap-8 overflow-y-auto h-full pb-20 scrollbar-hide">
          {status.message && (
            <div className="bg-brand-900/30 p-4 rounded-lg border border-brand-500/30 flex items-center justify-between text-xs font-mono">
              <span>{status.message}</span>
              <span className="bg-brand-600 px-2 py-0.5 rounded">{status.progress}%</span>
            </div>
          )}
          
          <section className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-2xl">
             <Player 
               audioUrl={audioUrl} scenes={project.scenes} aspectRatio={project.aspectRatio} videoTitle={project.videoTitle} onTimeUpdate={setCurrentTime} setProcessingStatus={setStatus} backgroundAudioFile={project.backgroundAudioFile} backgroundVolume={project.backgroundVolume} enableBackgroundMusic={project.enableBackgroundMusic} enableEmbers={project.enableEmbers} kenBurnsStrength={project.kenBurnsStrength} filmGrainStrength={project.filmGrainStrength} enableVaporOverlay={project.enableVaporOverlay} vaporOverlayFile={project.vaporOverlayFile} vaporOverlayOpacity={project.vaporOverlayOpacity} enableLetterboxing={project.enableLetterboxing} enablePolygonAssembly={project.enablePolygonAssembly} triggerAutoExport={false} onExportStarted={() => {}} onExportComplete={() => {}} isBatchMode={false} fullScript={project.scriptText} 
             />
             <Timeline scenes={project.scenes} audioDuration={project.audioDuration || 60} currentTime={currentTime} onSceneSelect={setSelectedSceneId} selectedSceneId={selectedSceneId} onUpdateSceneTimes={(s) => setProject(prev => ({...prev, scenes: s}))} />
          </section>

          <section className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-400 mb-6">Production Manager ({project.scenes.length} Scenes)</h3>
            <div className="grid grid-cols-1 gap-6">
              {project.scenes.map((scene, index) => (
                <SceneEditor 
                  key={scene.id} 
                  scene={scene} 
                  index={index} 
                  stage={project.visualStage}
                  onUpdate={(updates) => handleUpdateScene(scene.id, updates)}
                  onRetry={(prompt) => handleRetryScene(scene.id, prompt)}
                  onPreview={() => setPreviewScene(scene)}
                />
              ))}
            </div>
          </section>
        </div>
      </main>

      {showScriptWizard && (
          <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-8 shadow-2xl">
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold text-brand-400">Viral Script Architect</h3>
                            <button onClick={() => setShowScriptWizard(false)} className="text-gray-500 hover:text-white">&times;</button>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed italic">Generating a 1,400+ word time-travel journey script.</p>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Topic</label>
                            <input type="text" className="w-full bg-gray-950 border border-gray-700 rounded p-4 text-sm focus:border-brand-500 outline-none" placeholder="e.g. Victorian London..." value={wizardTopic} onChange={(e) => setWizardTopic(e.target.value)} />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowScriptWizard(false)} className="flex-1 py-3 border border-gray-700 rounded-lg text-sm">Cancel</button>
                            <button onClick={handleStartFullProduction} disabled={!wizardTopic} className="flex-1 py-3 bg-brand-600 disabled:opacity-50 rounded-lg font-bold text-sm hover:bg-brand-500 transition-all">GENERATE SCRIPT</button>
                        </div>
                    </div>
              </div>
          </div>
      )}
      {previewScene && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-10" onClick={() => setPreviewScene(null)}>
          {previewScene.videoClipUrl ? (
            <video src={previewScene.videoClipUrl} controls autoPlay className="max-w-full max-h-full rounded-xl shadow-2xl border border-gray-800" />
          ) : (
            <img src={previewScene.imageUrl} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-gray-800" alt="Preview" />
          )}
        </div>
      )}
    </div>
  );
};

const SceneEditor: React.FC<{ 
  scene: Scene; 
  index: number; 
  stage: string;
  onUpdate: (updates: Partial<Scene>) => void;
  onRetry: (prompt: string) => void;
  onPreview: () => void; 
}> = ({ scene, index, stage, onUpdate, onRetry, onPreview }) => {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden flex flex-col md:flex-row group hover:border-brand-500/50 transition-all">
      <div className="w-full md:w-64 aspect-video bg-black relative cursor-zoom-in overflow-hidden shrink-0" onClick={(scene.imageUrl || scene.videoClipUrl) ? onPreview : undefined}>
        {scene.videoClipUrl ? (
          <div className="relative w-full h-full">
            <video src={scene.videoClipUrl} className="w-full h-full object-cover" muted />
            <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
              <span className="bg-blue-600 text-[8px] font-bold px-1.5 py-0.5 rounded text-white uppercase tracking-widest">Video Clip</span>
            </div>
          </div>
        ) : scene.imageUrl ? (
          <img src={scene.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="Scene" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-900 text-[10px] text-gray-600 font-bold uppercase">
            Awaiting Visuals
          </div>
        )}
        <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-[10px] font-bold text-brand-400 border border-gray-800">#{index + 1}</div>
      </div>
      
      <div className="p-5 flex-1 space-y-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${scene.visualStyle === '3d-poly' ? 'bg-indigo-900/50 text-indigo-300 border border-indigo-500/30' : 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/30'}`}>
                {scene.visualStyle}
              </span>
              <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 text-[8px] font-bold uppercase tracking-wider border border-gray-700">
                {scene.transitionType}
              </span>
              <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${scene.medium === 'image' ? 'bg-orange-900/50 text-orange-300 border border-orange-500/30' : 'bg-blue-900/50 text-blue-300 border border-blue-500/30'}`}>
                {scene.medium}
              </span>
            </div>
            <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1 block">Visual Description (Stage 1)</label>
            <textarea 
              value={scene.visualDescription} 
              onChange={(e) => onUpdate({ visualDescription: e.target.value })}
              className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-xs focus:border-brand-500 outline-none h-16"
            />
          </div>
          <div className="text-[10px] text-gray-500 font-mono text-right shrink-0">
            {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s
          </div>
        </div>

        {scene.imagePrompt && (
          <div>
            <label className="text-[9px] font-bold text-brand-400 uppercase tracking-widest mb-1 block">Image Generation Prompt (Stage 2)</label>
            <textarea 
              value={scene.imagePrompt} 
              onChange={(e) => onUpdate({ imagePrompt: e.target.value })}
              className="w-full bg-gray-900/50 border border-indigo-900 rounded p-2 text-[11px] focus:border-brand-500 outline-none h-20 text-indigo-100"
            />
          </div>
        )}

        {scene.videoPrompt && (
          <div>
            <label className="text-[9px] font-bold text-amber-500 uppercase tracking-widest mb-1 block">Video Motion Prompt (Stage 3)</label>
            <textarea 
              value={scene.videoPrompt} 
              onChange={(e) => onUpdate({ videoPrompt: e.target.value })}
              className="w-full bg-gray-900/50 border border-amber-900/50 rounded p-2 text-[11px] focus:border-brand-500 outline-none h-20 text-amber-100"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button 
            onClick={() => onRetry(scene.imagePrompt || scene.visualDescription)} 
            disabled={scene.isGeneratingImage} 
            className="px-6 py-2 bg-brand-600 hover:bg-brand-500 rounded text-[10px] font-bold transition-all disabled:opacity-50"
          >
            {scene.isGeneratingImage ? 'PRODUCING...' : 'RENDER IMAGE'}
          </button>
          <div className="flex-1 italic text-[9px] text-gray-500 flex items-center">
            "{scene.scriptSegment}"
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
