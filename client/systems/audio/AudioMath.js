/**
 * Lanthorn-PSG Audio Constants & Musical Pitch Math
 */

export const PSG_CONSTANTS = {
  HIFI_SAMPLE_RATE: 44100,
  LOFI_SAMPLE_RATE: 11025,
  DEFAULT_SAMPLE_RATE: 22050,
  ROOT_A4_FREQ: 440.0
};

export function midiToFreq(midi) {
  return PSG_CONSTANTS.ROOT_A4_FREQ * Math.pow(2, (midi - 69) / 12);
}

export const NOTE_OFFSETS = {
  'C': 0, 'C#': 1, 'DB': 1,
  'D': 2, 'D#': 3, 'EB': 3,
  'E': 4,
  'F': 5, 'F#': 6, 'GB': 6,
  'G': 7, 'G#': 8, 'AB': 8,
  'A': 9, 'A#': 10, 'BB': 10,
  'B': 11
};

export function noteToMidi(noteStr) {
  if (!noteStr || typeof noteStr !== 'string') return 60;
  const clean = noteStr.trim().toUpperCase().replace('-', '');
  const match = clean.match(/^([A-G][#B]?)(-?\d+)$/);
  if (!match) return 60;
  return (parseInt(match[2], 10) + 1) * 12 + (NOTE_OFFSETS[match[1]] ?? 0);
}
