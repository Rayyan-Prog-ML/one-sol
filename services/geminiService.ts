
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Scene, AspectRatio } from "../types";

export const STYLE_RECIPES = {
  '3d-poly': "Low-poly 3D model, isometric view, clay render style, octane render, soft studio lighting, minimalist geometry, C4D, high-end architectural visualization, tilt-shift photography, blueprint aesthetic.",
  'realistic': "Masterpiece oil painting, Chiaroscuro lighting, 8k resolution, historical accuracy, rich textures, dramatic atmosphere, cinematic realism."
};

export const SAFETY_BLOCK = "STRICT YOUTUBE AD POLICY COMPLIANCE: No profanity, nudity, or graphic battlefield gore. Maintain a respectful documentary tone.";

/**
 * Verifies if the API keys are present.
 */
export const verifyApiKeys = async (): Promise<{gemini: boolean, nvidia: boolean, openai: boolean}> => {
    try {
        const res = await fetch("/api/keys-status");
        if (res.ok) return await res.json();
    } catch (e) {}
    return {
        gemini: !!process.env.GEMINI_API_KEY || !!process.env.API_KEY,
        nvidia: !!process.env.NVIDIA_API_KEY,
        openai: !!process.env.OPENAI_API_KEY
    };
};

/**
 * HIGH-CAPACITY RETRY ENGINE
 */
async function executeWithRetry<T>(
  operation: (ai: GoogleGenAI) => Promise<T>, 
  retries = 3
): Promise<T> {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const ai = new GoogleGenAI({ apiKey: apiKey as string });
    return await operation(ai);
  } catch (error: any) {
    const status = error.status || error.response?.status;
    const isTransient = status === 429 || status >= 500 || !status;

    if (isTransient && retries > 0) {
        const baseDelay = status === 429 ? 5000 : 1000;
        const attemptNumber = 3 - retries;
        const delayMs = Math.min(baseDelay * Math.pow(2, attemptNumber), 45000);
        console.warn(`[GEMINI FAIL] Status ${status}. Retrying. Retries left: ${retries}`);
        await new Promise(r => setTimeout(r, delayMs));
        return executeWithRetry(operation, retries - 1);
    }
    throw error;
  }
}

/**
 * Stage 1: Scenes:)
 * Generates scenes with natural documentary pacing (avg 8-12 seconds).
 */
export const generateScenes = async (script: string, totalDuration: number): Promise<Scene[]> => {
  const targetSceneCount = Math.max(1, Math.ceil(totalDuration / 10));

  return await executeWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: `Now that you have analyzed the full script, generate the scenes according to the script.
      The total number of scenes should be approximately ${targetSceneCount}. 
      
      Instructions:
      1. Scene length should be natural based on the content (typically 6-12 seconds).
      2. Ensure scenes match the pacing and visual style of high-end historical documentaries.
      3. VISUAL STRATEGY: 
         - Use '3d-poly' style for world-building, maps, wide shots, and architectural overviews.
         - Use 'realistic' style for character close-ups, emotional moments, and specific historical details.
      4. TRANSITIONS:
         - Use 'zoom-through' for moving between locations or into details.
         - Use 'polygon-wipe' for major chapter changes or style shifts.
         - Use 'parallax-2.5d' for static shots that need depth.
      5. MEDIUM DETECTION:
         - Assign 'image' for portraits, specific historical figures (like Henry VIII), static objects, or scenes where a powerful still image conveys more emotion.
         - Assign 'video' for scenes involving action, movement, sweeping cinematic vistas, or dynamic events.
      6. Provide only the scenes—no extra explanation.
      
      SCRIPT: ${script.substring(0, 60000)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            totalScenes: { type: Type.INTEGER },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scriptSegment: { type: Type.STRING },
                  visualDescription: { type: Type.STRING },
                  visualStyle: { type: Type.STRING, enum: ['3d-poly', 'realistic'] },
                  transitionType: { type: Type.STRING, enum: ['zoom-through', 'polygon-wipe', 'parallax-2.5d', 'standard'] },
                  medium: { type: Type.STRING, enum: ['image', 'video'] }
                },
                required: ["scriptSegment", "visualDescription", "visualStyle", "transitionType", "medium"]
              }
            }
          },
          required: ["scenes"]
        }
      }
    });

    const data = JSON.parse(response.text || '{"scenes":[]}');
    let scenesData = data.scenes || [];
    
    const actualTarget = scenesData.length > 0 ? scenesData.length : targetSceneCount;
    const segmentDuration = totalDuration / actualTarget;
    
    return scenesData.map((s: any, i: number) => ({
      id: `scene-${i}-${Date.now()}`,
      scriptSegment: s.scriptSegment,
      visualDescription: s.visualDescription,
      visualStyle: s.visualStyle || 'realistic',
      transitionType: s.transitionType || 'parallax-2.5d',
      medium: s.medium || 'video',
      startTime: i * segmentDuration,
      endTime: (i + 1) * segmentDuration,
      isGeneratingImage: false
    }));
  }, 3);
};

/**
 * Stage 2: Image Prompts:)
 */
export const generateImagePrompts = async (scenes: Scene[]): Promise<string[]> => {
  return await executeWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: `Now that you have provided all the scenes, analyze each individual scene and generate highly detailed image prompts exactly according to how the visuals were described in the video-style scenes.
      
      Instructions:
      1. Ensure that every image prompt clearly maintains visual continuity.
      2. Respect the assigned visual style ('3d-poly' vs 'realistic').
         - For '3d-poly': Focus on geometry, layout, isometric angles, and "miniature" feel.
         - For 'realistic': Focus on texture, lighting, emotion, and "cinematic" feel.
      3. Provide only the detailed image prompts for every scene, with no extra explanation or commentary. Do not include scene numbers or indices.
      
      SCENES: ${JSON.stringify(scenes.map(s => ({ description: s.visualDescription, style: s.visualStyle })))}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prompts: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["prompts"]
        }
      }
    });
    return JSON.parse(response.text || '{"prompts":[]}').prompts;
  }, 2);
};

/**
 * Stage 3: Video Prompts:)
 */
export const generateVideoPrompts = async (scenes: Scene[]): Promise<string[]> => {
  return await executeWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: `I now have all the generated images and want to convert them into a complete video. 
      Create detailed video generation prompts for each image so that I can smoothly transform the images into cinematic video scenes.
      
      Each prompt should clearly include:
      ● Camera movement, motion, and transitions
      ● Lighting changes and visual effects
      ● Scene atmosphere and depth
      ● Continuity with the previous scene (if applicable)
      ● Cinematic realism and professional video style

      IMPORTANT: Provide the video prompts scene-by-scene in order. 
      DO NOT include any numbers, labels (like 'Scene 1'), indices, or explanation. 
      ONLY provide the raw, direct usable prompts, one per scene.
      
      SCENES: ${JSON.stringify(scenes.map(s => s.imagePrompt || s.visualDescription))}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            videoPrompts: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["videoPrompts"]
        }
      }
    });
    return JSON.parse(response.text || '{"videoPrompts":[]}').videoPrompts;
  }, 2);
};

/**
 * Image Generation Cluster
 */
export const generateImageForScene = async (description: string, aspectRatio: AspectRatio, style: '3d-poly' | 'realistic' = 'realistic'): Promise<string> => {
    const styleKeywords = STYLE_RECIPES[style] || STYLE_RECIPES['realistic'];
    const finalPrompt = `STYLE: ${styleKeywords} SCENE: ${description}. ${SAFETY_BLOCK}`;
    
    try {
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: finalPrompt, aspectRatio })
        });

        if (response.ok) {
            const data = await response.json();
            // NVIDIA NIM can return artifacts[0].base64 or image
            const base64 = data.artifacts?.[0]?.base64 || data.image;
            if (base64) return `data:image/png;base64,${base64}`;
        }
    } catch (e) {
        console.warn("NVIDIA Backend failed, falling back to Gemini", e);
    }

    // Fallback to Gemini if NVIDIA key is missing or failed
    return await executeWithRetry(async (ai) => {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: finalPrompt }] },
            config: { imageConfig: { aspectRatio: aspectRatio as any } },
        });
        const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (part?.inlineData?.data) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        throw new Error("EMPTY_GEMINI_IMAGE_RESPONSE");
    }, 5); 
};

export const masterAuditScript = async (script: string, topic: string): Promise<{ auditedScript: string; changesLog: string }> => {
  const result = await executeWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `You are a professional script editor. Review this long-form documentary script. Identify patches. Topic: ${topic}. Script: ${script}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  originalSnippet: { type: Type.STRING },
                  improvedText: { type: Type.STRING },
                  reason: { type: Type.STRING }
                },
                required: ["originalSnippet", "improvedText", "reason"]
              }
            },
            summaryOfChanges: { type: Type.STRING }
          }
        }
      }
    });
    return JSON.parse(response.text || '{"patches":[], "summaryOfChanges":""}');
  }, 2);

  let finalScript = script;
  let log = `Summary: ${result.summaryOfChanges}\n\nEdits:\n`;
  result.patches.forEach((patch: any) => {
    if (finalScript.includes(patch.originalSnippet)) {
      finalScript = finalScript.replace(patch.originalSnippet, patch.improvedText);
      log += `[MOD] ${patch.reason}\n`;
    }
  });
  return { auditedScript: finalScript, changesLog: log };
};

/**
 * SILENCE TRUNCATION ENGINE
 * Removes parts of audio below a threshold to tighten narration.
 */
export const trimSilenceFromAudio = async (blob: Blob): Promise<Blob> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const threshold = 0.015; // Volume threshold
    const minSilenceSamples = sampleRate * 0.4; // 400ms minimum silence to cut
    const paddingSamples = sampleRate * 0.1; // 100ms padding
    
    let isSilent = true;
    let silenceStart = 0;
    const keepSegments: { start: number; end: number }[] = [];
    
    let currentSegmentStart = -1;

    for (let i = 0; i < channelData.length; i++) {
        const amplitude = Math.abs(channelData[i]);
        
        if (amplitude > threshold) {
            if (currentSegmentStart === -1) {
                currentSegmentStart = Math.max(0, i - paddingSamples);
            }
            isSilent = false;
            silenceStart = i;
        } else {
            if (!isSilent && (i - silenceStart) > minSilenceSamples) {
                const end = Math.min(channelData.length, i - minSilenceSamples + paddingSamples);
                keepSegments.push({ start: currentSegmentStart, end });
                currentSegmentStart = -1;
                isSilent = true;
            }
        }
    }
    
    // Add final segment if needed
    if (currentSegmentStart !== -1) {
        keepSegments.push({ start: currentSegmentStart, end: channelData.length });
    }

    if (keepSegments.length === 0) return blob; // Fallback

    const totalSamples = keepSegments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
    const cleanedPcm = new Int16Array(totalSamples);
    let offset = 0;
    
    for (const seg of keepSegments) {
        for (let j = seg.start; j < seg.end; j++) {
            cleanedPcm[offset++] = Math.max(-1, Math.min(1, channelData[j])) * 32767;
        }
    }

    const wavBlob = createWavBlob(cleanedPcm.buffer, sampleRate);
    audioContext.close();
    return wavBlob;
};

const createWavBlob = (pcmBuffer: ArrayBuffer, sampleRate: number): Blob => {
    const byteLength = pcmBuffer.byteLength;
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + byteLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeStr(36, 'data');
    view.setUint32(40, byteLength, true);

    return new Blob([new Uint8Array(wavHeader), new Uint8Array(pcmBuffer)], { type: 'audio/wav' });
};

export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type OpenAIVoice = typeof OPENAI_VOICES[number];

export const generateOpenAIVoiceOver = async (
    text: string, 
    voice: OpenAIVoice,
    onProgress: (p: number, m: string) => void
): Promise<Blob> => {
    const cleanedText = text.replace(/[*_#~`]/g, '').trim();
    
    onProgress(10, "Connecting to OpenAI...");
    const response = await fetch("/api/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanedText, voice })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "OpenAI Synthesis Failed");
    }

    const blob = await response.blob();
    
    // Apply Silence Truncation Engine to tighten the narration
    onProgress(99, "Cleaning Silence...");
    return await trimSilenceFromAudio(blob);
};

export const generateVoiceOver = async (text: string, onProgress: (p: number, m: string) => void): Promise<Blob> => {
    const cleanedText = text.replace(/[*_#~`]/g, '').trim();
    const chunks: string[] = [];
    let pos = 0;
    while (pos < cleanedText.length) {
        let end = Math.min(pos + 800, cleanedText.length);
        if (end < cleanedText.length) {
            const lastPeriod = cleanedText.lastIndexOf('. ', end);
            if (lastPeriod > pos) end = lastPeriod + 1;
        }
        chunks.push(cleanedText.substring(pos, end).trim());
        pos = end;
    }

    const audioChunks: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
        onProgress(Math.round(((i + 1) / chunks.length) * 100), `Narration: ${i + 1}/${chunks.length}...`);
        const part = await executeWithRetry(async (ai) => {
            const res = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: chunks[i] }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
                }
            });
            const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64) throw new Error("TTS_CHUNK_FAILED");
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
            return bytes;
        }, 3);
        audioChunks.push(part);
        await new Promise(r => setTimeout(r, 100));
    }

    const totalLen = audioChunks.reduce((acc, curr) => acc + curr.length, 0);
    const mergedPcm = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of audioChunks) {
        mergedPcm.set(chunk, offset);
        offset += chunk.length;
    }
    
    const initialBlob = createWavBlob(mergedPcm.buffer, 24000);
    // CLEAN THE SILENCE AUTOMATICALLY
    onProgress(99, "Cleaning Silence...");
    return await trimSilenceFromAudio(initialBlob);
};

/**
 * MASTER STORY ARCHITECT
 */
export const refineStoryOutline = async (topic: string, rawChapters: string[]): Promise<string[]> => {
    return executeWithRetry(async (ai) => {
        const prompt = `You are the Senior Executive Editor for 'The Napping Historian' YouTube Channel. Your job is to take a raw chapter outline and refine it for:

HISTORICAL ACCURACY: Verify dates, names, and sequence of events.

AD-POLICY COMPLIANCE: ${SAFETY_BLOCK}

RETENTION OPTIMIZATION: Ensure the chapters flow logically into a 2-hour epic.

TONE: Maintain a mysterious, professional, and slightly eerie atmosphere.

TOPIC: ${topic}
RAW CHAPTERS: ${rawChapters.join('|')}

OUTPUT RULE: Return the refined chapters as a polished list. Do not change the number of chapters significantly.`;

        const res = await ai.models.generateContent({
            model: "gemini-3-pro-preview", 
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { refinedChapters: { type: Type.ARRAY, items: { type: Type.STRING } } },
                    required: ["refinedChapters"]
                }
            }
        });
        return JSON.parse(res.text || '{"refinedChapters":[]}').refinedChapters;
    }, 2);
};

export const generateStoryOutline = async (topic: string, count: number): Promise<string[]> => {
    const rawChapters = await executeWithRetry(async (ai) => {
        const prompt = `Acting as the head writer for the 'History Untold' YouTube channel, create a 5-chapter outline for a script titled "${topic}".
        The total word count must be between 1200 and 1500 words. The script must avoid all gore or graphic medical descriptions, focusing instead on psychological trauma, courtly manipulation, and historical secrets.
        
        Outline Structure:
        1. Chapter 1: The Fatal Hook (200 words) – Use the signature intro: 'What if I told you...' Establish a central mystery based on a hidden document or a secret portrait.
        2. Chapter 2: The Pawn’s Cradle (300 words) – Focus on childhood as a 'bargaining chip' or 'royal property'. Use the theme of abandonment or being raised for a role the character never chose.
        3. Chapter 3: The Gilded Spiderweb (300 words) – The moment of entering the King’s inner circle. Describe the suffocating protocol, the silence of allies, and the 'survival performance' the character had to maintain.
        4. Chapter 4: The Cold Betrayal (400 words) – The climax. Focus on the psychological weight of the 'Bill of Attainder', the sound of the tower gates closing, or the ink on a final letter.
        5. Chapter 5: The Silent Victory (250 words) – The legacy and historical justice. End with the signature question: 'Was it courage or simply a game they were forced to play?'.
        
        For each chapter, provide a Psychological Hook and Technical Details (e.g., mention specific archival records, courtly letters, or secret seals).
        
        Output a simple list of these 5 chapter titles.`;
        
        const res = await ai.models.generateContent({
            model: "gemini-3-flash-preview", 
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { chapters: { type: Type.ARRAY, items: { type: Type.STRING } } },
                    required: ["chapters"]
                }
            }
        });
        return JSON.parse(res.text || '{"chapters":[]}').chapters;
    });

    return await refineStoryOutline(topic, rawChapters);
};

/**
 * THE VIRAL MASTER SCRIPT GENERATOR
 */
export const generateStoryChapter = async (topic: string, chapter: string, prevSummary: string, fullOutline: string, idx: number, total: number): Promise<{ content: string; summary: string }> => {
    return executeWithRetry(async (ai) => {
        const prompt = `Acting as the head writer for the 'History Untold' YouTube channel, expand on "${chapter}" for the script about "${topic}".
        
        Writing Style Requirements:
        • Intimate Tone: Use the 'Alex' signature style—dark, whispery, and visceral. Focus on the scents of incense and old parchment, the rustle of heavy silk, and the cold stone of the tower walls.
        • The Mask: Emphasise the 'performance' of royalty and the internal monologue of a character trapped in a system that views them as property.
        • Historical Evidence: Incorporate phrases like 'What the history books don't tell you...' or 'A letter found in the Cotton Manuscripts centuries later...'.
        • Signature Intro: If this is Chapter 1, begin with: 'I’m Ryan, and together we’ll uncover the hidden secrets of the past'.
        • Narrative Ending: Every chapter must end with a cliffhanger that leads into the next chapter's technical historical details.
        
        Avoid all gore or graphic medical descriptions. Focus on psychological trauma.
        
        Current Chapter: ${chapter}
        Chapter ${idx} of ${total}
        Previous Context: ${prevSummary}
        
        Output the full chapter content and a brief summary.`;

        const res = await ai.models.generateContent({
            model: "gemini-3-flash-preview", 
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { content: { type: Type.STRING }, summary: { type: Type.STRING } },
                    required: ["content", "summary"]
                }
            }
        });
        return JSON.parse(res.text || '{"content":"", "summary":""}');
    }, 5);
};

export const generateVideoMetadata = async (script: string, topic: string): Promise<string> => {
    const result = await executeWithRetry(async (ai) => {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `Generate YouTube SEO metadata for this documentray: ${topic}. Script: ${script.substring(0, 4000)}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["title", "description", "hashtags", "tags"]
                }
            }
        });
        return JSON.parse(response.text || '{}');
    }, 2);

    return `
${result.title}

${result.description}

🔔 Subscribe to The Napping Historian for more Boring History for Sleep.

${result.hashtags.join(' ')}

Tags: ${result.tags.join(', ')}
    `.trim();
};

export const analyzeScript = async (script: string, totalDuration: number): Promise<Scene[]> => {
    return generateScenes(script, totalDuration);
};
