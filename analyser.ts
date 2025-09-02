/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Analyser class for live audio visualisation.
 */
export class Analyser {
  private analyser: AnalyserNode;
  private bufferLength = 0;
  private dataArray: Uint8Array;
  private _energy = 0;
  private smoothingFactor = 0.1; // Determines how quickly the energy value reacts to changes

  constructor(node: AudioNode) {
    this.analyser = node.context.createAnalyser();
    this.analyser.fftSize = 32;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    node.connect(this.analyser);
  }

  update() {
    this.analyser.getByteFrequencyData(this.dataArray);

    // Calculate raw energy as the average amplitude across frequency bins
    const sum = this.dataArray.reduce((a, b) => a + b, 0);
    const rawEnergy = (sum / this.bufferLength || 0) / 255; // Normalize to 0-1

    // Smooth the energy value using linear interpolation for smoother transitions
    this._energy += (rawEnergy - this._energy) * this.smoothingFactor;
  }

  get data() {
    return this.dataArray;
  }

  /**
   * Returns the smoothed energy level of the audio signal (0-1).
   * This can be interpreted as the "excitement" or "intensity" of the sound.
   */
  get energy() {
    return this._energy;
  }
}
