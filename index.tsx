/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';


const AVAILABLE_VOICES = ['Orus', 'Aries', 'Leo', 'Lyra', 'Taurus'];
const DEFAULT_PERSONALITY = {
  name: 'Default',
  prompt: 'You are a helpful and friendly AI assistant.',
};

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() selectedVoice = AVAILABLE_VOICES[0];
  @state() personalities: Array<{name: string; prompt: string}> = [];
  @state() selectedPersonality: {name: string; prompt: string} | null = null;
  @state() isPersonalityModalOpen = false;
  @state() uploadedImage: {data: string; mimeType: string} | null = null;
  @state() useGoogleSearch = false;
  @state() groundingChunks: any[] = [];
  @state() isArModeActive = false;

  private client: GoogleGenAI;
  private session: Session;
  // FIX: Cast window to any to access legacy webkitAudioContext
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // FIX: Cast window to any to access legacy webkitAudioContext
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  // Silence detection
  private silenceTimer: any = null;
  private readonly SILENCE_THRESHOLD = 0.01; // Amplitude threshold for silence
  private readonly SILENCE_DURATION = 1500; // 1.5 seconds of silence

  // AR Mode
  private videoStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private frameCaptureInterval: any = null;

  static styles = css`
    :host {
      width: 100%;
      height: 100%;
      display: block;
      background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
      position: relative;
      overflow: hidden;
    }

    #ar-video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: -1;
      transform: scaleX(-1); /* Mirror view for selfie cam */
    }

    .ar-active-visualizer {
      opacity: 0;
      pointer-events: none;
    }

    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      background: rgba(0, 0, 0, 0.3);
      padding: 8px 16px;
      border-radius: 8px;
      margin: 0 20px;
      backdrop-filter: blur(10px);
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 2px solid #4a90e2;
        color: white;
        border-radius: 12px;
        background: rgba(74, 144, 226, 0.8);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      button:hover {
        background: rgba(74, 144, 226, 1);
        transform: scale(1.05);
      }

      button.active {
        background: #4a90e2;
        border-color: #4a90e2;
        box-shadow: 0 0 20px rgba(74, 144, 226, 0.6);
      }
    }

    button[disabled] {
      display: none;
    }

    .control-group {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      color: white;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 8px;
      padding: 12px 16px;
      border: 2px solid rgba(74, 144, 226, 0.5);
      backdrop-filter: blur(10px);
    }

    .control-group label {
      font-weight: bold;
      color: white;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
    }

    .control-group select,
    .control-group button {
      background: rgba(0, 0, 0, 0.3);
      color: white;
      border: 1px solid rgba(74, 144, 226, 0.5);
      font-size: 16px;
      cursor: pointer;
      outline: none;
      border-radius: 4px;
      padding: 4px 8px;
    }

    .control-group select {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 8px center;
      background-size: 1em;
      padding-right: 2em;
    }

    .control-group button {
      margin-left: 8px;
      transition: all 0.3s ease;
    }

    .control-group button:hover {
      background: rgba(74, 144, 226, 0.7);
      border-color: #4a90e2;
    }

    .control-group select:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    /* Toggle Switch styles */
    .switch {
      position: relative;
      display: inline-block;
      width: 50px;
      height: 28px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.2);
      transition: 0.4s;
      border-radius: 28px;
    }

    .slider:before {
      position: absolute;
      content: '';
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.4s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: #4a90e2;
    }

    input:checked + .slider:before {
      transform: translateX(22px);
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(5px);
    }

    .modal-content {
      background: rgba(20, 20, 30, 0.9);
      color: white;
      padding: 24px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .modal-content h2,
    .modal-content h3 {
      margin: 0;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .personality-form form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .personality-form input,
    .personality-form textarea {
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 10px;
      color: white;
      font-size: 16px;
      outline: none;
      box-sizing: border-box;
    }

    .personality-form textarea {
      min-height: 100px;
      resize: vertical;
    }

    .personality-form button {
      background: #4a4af0;
      color: white;
      border: none;
      padding: 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
    }

    .personality-form button:hover {
      background: #6a6aff;
    }

    .personality-list ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .personality-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
    }

    .personality-list li.selected {
      background: rgba(74, 74, 240, 0.4);
      font-weight: bold;
    }

    .personality-list button {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
      margin-left: 8px;
    }

    .personality-list button:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .personality-list button.delete-btn {
      border-color: #ff4d4d;
      color: #ff4d4d;
    }

    .personality-list button.delete-btn:hover {
      background: rgba(255, 77, 77, 0.2);
    }

    .personality-list button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .close-modal-btn {
      align-self: flex-end;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .action-buttons {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    .image-preview-container {
      position: absolute;
      bottom: 30vh;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
    }

    .image-preview {
      position: relative;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(5px);
    }

    .image-preview img {
      display: block;
      max-width: 150px;
      max-height: 150px;
      object-fit: contain;
    }

    .remove-image-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      font-size: 16px;
      line-height: 24px;
      text-align: center;
      cursor: pointer;
      padding: 0;
    }

    .remove-image-btn:hover {
      background: rgba(255, 20, 20, 0.8);
    }

    .grounding-container {
      position: absolute;
      bottom: 35vh;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      width: 80%;
      max-width: 600px;
      z-index: 10;
    }

    .grounding-link {
      display: flex;
      align-items: center;
      background: rgba(0, 0, 0, 0.6);
      color: #e0e0e0;
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(5px);
      font-size: 14px;
      max-width: 280px;
      transition: background-color 0.3s;
    }

    .grounding-link:hover {
      background: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .grounding-link .g-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background-image: linear-gradient(to bottom, #4285f4, #34a853, #fbbc05, #ea4335);
      font-weight: bold;
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      margin-right: 8px;
      flex-shrink: 0;
    }

    .grounding-link .title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Simple CSS Visualizer */
    .simple-visualizer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 1;
    }

    .audio-wave {
      position: relative;
      width: 200px;
      height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .wave-circle {
      position: absolute;
      border: 2px solid rgba(74, 144, 226, 0.3);
      border-radius: 50%;
      background: radial-gradient(circle, rgba(74, 144, 226, 0.1) 0%, transparent 70%);
    }

    .wave-circle:nth-child(1) {
      width: 60px;
      height: 60px;
      animation: pulse 2s ease-in-out infinite;
    }

    .wave-circle.wave-2 {
      width: 120px;
      height: 120px;
      animation: pulse 2s ease-in-out infinite 0.5s;
    }

    .wave-circle.wave-3 {
      width: 180px;
      height: 180px;
      animation: pulse 2s ease-in-out infinite 1s;
    }

    .audio-wave.recording .wave-circle {
      border-color: rgba(255, 100, 100, 0.6);
      background: radial-gradient(circle, rgba(255, 100, 100, 0.2) 0%, transparent 70%);
      animation-duration: 1s;
    }

    .audio-wave.recording .wave-circle:nth-child(1) {
      box-shadow: 0 0 20px rgba(255, 100, 100, 0.4);
    }

    @keyframes pulse {
      0% {
        transform: scale(0.8);
        opacity: 1;
      }
      50% {
        transform: scale(1.2);
        opacity: 0.6;
      }
      100% {
        transform: scale(0.8);
        opacity: 1;
      }
    }
  `;

  constructor() {
    super();
    this.loadPersonalities();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    // FIX: Use process.env.API_KEY per coding guidelines.
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash';

    try {
      const config: any = {
        systemInstruction: this.selectedPersonality?.prompt,
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: this.selectedVoice}},
        },
      };

      if (this.useGoogleSearch) {
        config.tools = [{googleSearch: {}}];
      }

      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Session connected');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const groundingMetadata = message.serverContent?.groundingMetadata;
            if (groundingMetadata?.groundingChunks) {
              this.groundingChunks = [
                ...this.groundingChunks,
                ...groundingMetadata.groundingChunks,
              ];
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed');
          },
        },
        config: config,
      });
    } catch (e) {
      console.error(e);
      this.updateError(e.message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.groundingChunks = [];
    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');

    try {
      // Use existing video stream if in AR mode, otherwise get a new audio stream
      if (this.isArModeActive && this.videoStream) {
        this.mediaStream = this.videoStream;
      } else {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        // Silence detection logic
        let maxAmplitude = 0;
        for (let i = 0; i < pcmData.length; i++) {
          const amp = Math.abs(pcmData[i]);
          if (amp > maxAmplitude) {
            maxAmplitude = amp;
          }
        }

        if (maxAmplitude > this.SILENCE_THRESHOLD) {
          // Sound detected, clear any running silence timer
          if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
          }
        } else {
          // Silence detected, start a timer if not already running
          if (!this.silenceTimer) {
            this.silenceTimer = setTimeout(() => {
              this.stopRecording();
            }, this.SILENCE_DURATION);
          }
        }

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream && !this.isArModeActive) {
      // Only stop tracks if we are not in AR mode
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped.');
  }

  private reset() {
    this.session?.close();
    this.groundingChunks = [];
    this.initSession();
    this.updateStatus('Session reset.');
  }

  private handleVoiceChange(e: Event) {
    const selectElement = e.target as HTMLSelectElement;
    this.selectedVoice = selectElement.value;
    this.reset();
  }

  private toggleGoogleSearch(e: Event) {
    this.useGoogleSearch = (e.target as HTMLInputElement).checked;
    this.reset();
  }

  // Image Handling
  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target!.result as string;
        const [header, base64Data] = dataUrl.split(',');
        const mimeType = header.match(/:(.*?);/)![1];

        this.uploadedImage = {data: base64Data, mimeType};
        this.sendImageToSession();
      };
      reader.readAsDataURL(file);
      input.value = ''; // Reset input so same file can be re-uploaded
    }
  }

  private async sendImageToSession() {
    if (!this.session || !this.uploadedImage) return;

    this.updateStatus('Sending image...');
    try {
      // FIX: `sendInput` does not exist on `Session`. Changed to `sendTurn`, which is inferred from server responses containing `modelTurn`.
      await (this.session as any).sendTurn({
        parts: [
          {
            inlineData: {
              data: this.uploadedImage.data,
              mimeType: this.uploadedImage.mimeType,
            },
          },
        ],
      });
      this.updateStatus('Image sent. Ready to chat.');
    } catch (e) {
      this.updateError(`Error sending image: ${e.message}`);
    }
  }

  private removeImage() {
    this.uploadedImage = null;
    this.reset(); // Reset the session to clear the image context
  }

  // AR Mode
  private async toggleArMode() {
    if (this.isArModeActive) {
      this.stopArMode();
    } else {
      this.startArMode();
    }
  }

  private async startArMode() {
    if (this.isRecording) {
      this.stopRecording();
    }
    this.updateStatus('Starting AR Mode...');
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'user'},
        audio: true,
      });
      this.videoElement!.srcObject = this.videoStream;
      this.videoElement!.play();
      this.isArModeActive = true;
      this.frameCaptureInterval = setInterval(
        () => this.captureAndSendFrame(),
        1000,
      ); // Send a frame every second
      this.updateStatus('AR Mode Active. Talk to describe what you see.');
    } catch (err) {
      this.updateError(`Error starting AR mode: ${err.message}`);
    }
  }

  private stopArMode() {
    this.updateStatus('Stopping AR Mode...');
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }
    this.isArModeActive = false;
    this.videoElement!.srcObject = null;
    this.updateStatus('AR Mode stopped.');
    this.reset(); // Reset session to clear visual context
  }

  private captureAndSendFrame() {
    if (!this.isArModeActive || !this.videoElement || !this.session) return;

    const context = this.canvasElement!.getContext('2d');
    if (context) {
      this.canvasElement!.width = this.videoElement.videoWidth;
      this.canvasElement!.height = this.videoElement.videoHeight;
      context.drawImage(
        this.videoElement,
        0,
        0,
        this.canvasElement.width,
        this.canvasElement.height,
      );
      const dataUrl = this.canvasElement.toDataURL('image/jpeg', 0.5);
      const [, base64Data] = dataUrl.split(',');

      (this.session as any).sendTurn({
        parts: [{inlineData: {data: base64Data, mimeType: 'image/jpeg'}}],
      });
    }
  }

  // Personality Management
  private loadPersonalities() {
    const stored = localStorage.getItem('gdm-personalities');
    if (stored) {
      this.personalities = JSON.parse(stored);
    } else {
      this.personalities = [DEFAULT_PERSONALITY];
    }

    const selected = localStorage.getItem('gdm-selected-personality');
    this.selectedPersonality = selected
      ? JSON.parse(selected)
      : this.personalities[0];
  }

  private savePersonalities() {
    localStorage.setItem(
      'gdm-personalities',
      JSON.stringify(this.personalities),
    );
  }

  private saveSelectedPersonality() {
    localStorage.setItem(
      'gdm-selected-personality',
      JSON.stringify(this.selectedPersonality),
    );
  }

  private openPersonalityModal() {
    this.isPersonalityModalOpen = true;
  }

  private closePersonalityModal() {
    this.isPersonalityModalOpen = false;
  }

  private handlePersonalityFormSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const name = formData.get('name') as string;
    const prompt = formData.get('prompt') as string;

    if (
      name &&
      prompt &&
      !this.personalities.find((p) => p.name === name)
    ) {
      const newPersonality = {name, prompt};
      this.personalities = [...this.personalities, newPersonality];
      this.savePersonalities();
      form.reset();
    } else {
      console.error('Personality name already exists or fields are empty.');
      // Optionally, provide user feedback here
    }
  }

  private handleSelectPersonality(personality: {name: string; prompt: string}) {
    this.selectedPersonality = personality;
    this.saveSelectedPersonality();
    this.closePersonalityModal();
    this.reset();
  }

  private handleDeletePersonality(personalityName: string) {
    if (personalityName === DEFAULT_PERSONALITY.name) return;

    this.personalities = this.personalities.filter(
      (p) => p.name !== personalityName,
    );
    this.savePersonalities();

    if (this.selectedPersonality?.name === personalityName) {
      this.selectedPersonality = this.personalities[0] ?? DEFAULT_PERSONALITY;
      this.saveSelectedPersonality();
      this.reset();
    }
  }

  renderPersonalityModal() {
    if (!this.isPersonalityModalOpen) return '';

    return html`
      <div class="modal-overlay" @click=${this.closePersonalityModal}>
        <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
          <h2>Manage Personalities</h2>

          <div class="personality-form">
            <h3>Create New Personality</h3>
            <form @submit=${this.handlePersonalityFormSubmit}>
              <input
                name="name"
                type="text"
                placeholder="Personality Name"
                required
              />
              <textarea
                name="prompt"
                placeholder="System Prompt (e.g., You are a witty pirate...)"
                required
              ></textarea>
              <button type="submit">Save Personality</button>
            </form>
          </div>

          <div class="personality-list">
            <h3>Existing Personalities</h3>
            <ul>
              ${this.personalities.map(
                (p) => html`
                  <li
                    class=${p.name === this.selectedPersonality?.name
                      ? 'selected'
                      : ''}
                  >
                    <span>${p.name}</span>
                    <div class="actions">
                      <button @click=${() => this.handleSelectPersonality(p)}>
                        Select
                      </button>
                      <button
                        class="delete-btn"
                        @click=${() => this.handleDeletePersonality(p.name)}
                        ?disabled=${p.name === DEFAULT_PERSONALITY.name}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                `,
              )}
            </ul>
          </div>
          <button @click=${this.closePersonalityModal} class="close-modal-btn">
            Close
          </button>
        </div>
      </div>
    `;
  }

  firstUpdated() {
    this.videoElement =
      this.shadowRoot!.querySelector<HTMLVideoElement>('#ar-video');
    this.canvasElement = document.createElement('canvas');
  }

  render() {
    return html`
      <div>
        <video id="ar-video" ?hidden=${!this.isArModeActive}></video>
        ${this.renderPersonalityModal()}
        <div class="image-preview-container">
          ${this.uploadedImage
            ? html`
                <div class="image-preview">
                  <img
                    src="data:${this.uploadedImage.mimeType};base64,${this
                      .uploadedImage.data}"
                    alt="Uploaded image preview"
                  />
                  <button
                    @click=${this.removeImage}
                    class="remove-image-btn"
                    aria-label="Remove Image"
                  >
                    &times;
                  </button>
                </div>
              `
            : ''}
        </div>

        <div class="grounding-container">
          ${this.groundingChunks.map(
            (chunk) => html`
              <a
                href=${chunk.web.uri}
                target="_blank"
                rel="noopener noreferrer"
                class="grounding-link"
                title=${chunk.web.title}
              >
                <span class="g-icon">G</span>
                <span class="title">${chunk.web.title}</span>
              </a>
            `,
          )}
        </div>

        <div class="controls">
          <div class="control-group">
            <label for="search-toggle">Google Search:</label>
            <label class="switch">
              <input
                id="search-toggle"
                type="checkbox"
                .checked=${this.useGoogleSearch}
                @change=${this.toggleGoogleSearch}
                ?disabled=${this.isRecording || this.isArModeActive}
              />
              <span class="slider"></span>
            </label>
          </div>
          <div class="control-group">
            <label for="voice-select">Voice:</label>
            <select
              id="voice-select"
              @change=${this.handleVoiceChange}
              ?disabled=${this.isRecording || this.isArModeActive}
              aria-label="Select a voice"
            >
              ${AVAILABLE_VOICES.map(
                (voice) =>
                  html`<option
                    value=${voice}
                    ?selected=${voice === this.selectedVoice}
                  >
                    ${voice}
                  </option>`,
              )}
            </select>
          </div>
          <div class="control-group">
            <label>Personality:</label>
            <span>${this.selectedPersonality?.name}</span>
            <button
              @click=${this.openPersonalityModal}
              ?disabled=${this.isArModeActive}
            >
              Manage
            </button>
          </div>

          <div class="action-buttons">
            <button
              id="arButton"
              @click=${this.toggleArMode}
              class=${this.isArModeActive ? 'active' : ''}
              ?disabled=${this.isRecording}
              aria-label="Toggle AR Mode"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff"
              >
                <path
                  d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-70q-46 0-78-32t-32-78q0-46 32-78t78-32q46 0 78 32t32 78q0 46-32 78t-78 32Zm0 190q-142 0-259-78.5T40-500q55-121 172-199.5T480-778q142 0 259 78.5T920-500q-55 121-172 199.5T480-200Z"
                />
              </svg>
            </button>
            <input
              type="file"
              id="imageUpload"
              @change=${this.handleImageUpload}
              accept="image/*"
              style="display: none;"
            />
            <button
              id="uploadButton"
              @click=${() =>
                (
                  this.shadowRoot?.getElementById('imageUpload') as HTMLElement
                )?.click()}
              ?disabled=${this.isRecording || this.isArModeActive}
              aria-label="Upload Image"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff"
              >
                <path
                  d="M220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h520q24 0 42 18t18 42v680q0 24-18 42t-42 18H220Zm0-60h520v-680H220v680Zm80-160h360q17 0 28.5-11.5T700-340q0-17-11.5-28.5T660-380H299.78q-16.53 0-28.16 11.64Q260-356.73 260-340q0 17 11.5 28.5T300-300Zm0-160h360q17 0 28.5-11.5T700-500q0-17-11.5-28.5T660-540H300q-17 0-28.5 11.5T260-500q0 17 11.5 28.5T300-460Zm280-200q25 0 42.5-17.5T640-720q0-25-17.5-42.5T580-780q-25 0-42.5 17.5T520-720q0 25 17.5 42.5T580-660ZM220-140v-680 680Z"
                />
              </svg>
            </button>
            <button
              id="resetButton"
              @click=${this.reset}
              ?disabled=${this.isRecording || this.isArModeActive}
              aria-label="Reset Session"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff"
              >
                <path
                  d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"
                />
              </svg>
            </button>
          </div>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}
            aria-label="Start Recording"
          >
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}
            aria-label="Stop Recording"
          >
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status">${this.error || this.status}</div>
        <div class="simple-visualizer ${this.isArModeActive ? 'ar-active-visualizer' : ''}">
          <div class="audio-wave ${this.isRecording ? 'recording' : ''}">
            <div class="wave-circle"></div>
            <div class="wave-circle wave-2"></div>
            <div class="wave-circle wave-3"></div>
          </div>
        </div>
      </div>
    `;
  }
}
