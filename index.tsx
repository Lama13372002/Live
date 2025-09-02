/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

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

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
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
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      button:hover {
        background: rgba(255, 255, 255, 0.2);
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
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .control-group label {
      font-weight: bold;
    }

    .control-group select,
    .control-group button {
      background: transparent;
      color: white;
      border: none;
      font-size: 16px;
      cursor: pointer;
      outline: none;
    }

    .control-group select {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 0 center;
      background-size: 1em;
      padding-right: 1.5em;
    }

    .control-group button {
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      margin-left: 8px;
    }

    .control-group button:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .control-group select:disabled {
      cursor: not-allowed;
      opacity: 0.5;
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
        config: {
          systemInstruction: this.selectedPersonality?.prompt,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: this.selectedVoice}},
          },
        },
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

    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

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

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session reset.');
  }

  private handleVoiceChange(e: Event) {
    const selectElement = e.target as HTMLSelectElement;
    this.selectedVoice = selectElement.value;
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
      // FIX: The method to send non-streaming input to a Session is `sendInput`.
      await this.session.sendInput({
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

  render() {
    return html`
      <div>
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

        <div class="controls">
          <div class="control-group">
            <label for="voice-select">Voice:</label>
            <select
              id="voice-select"
              @change=${this.handleVoiceChange}
              ?disabled=${this.isRecording}
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
            <button @click=${this.openPersonalityModal}>Manage</button>
          </div>

          <div class="action-buttons">
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
              ?disabled=${this.isRecording}
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
              ?disabled=${this.isRecording}
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
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
        ></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
