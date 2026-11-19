/**
 * Colour model shared by the photo editor and the video grader.
 * Every value is a slider position; the shader in gl/adjust.ts maps it to real maths.
 */
export interface Adjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  gamma: number;
  clarity: number;
  sharpness: number;
  dehaze: number;
  vignette: number;
  grain: number;
  // Grading wheels (video inspector, also usable on photos)
  lift: number;
  gain: number;
  red: number;
  green: number;
  blue: number;
}

export const DEFAULT_ADJ: Adjustments = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, gamma: 0, clarity: 0, sharpness: 0,
  dehaze: 0, vignette: 0, grain: 0, lift: 0, gain: 0, red: 0, green: 0, blue: 0,
};

export type AdjKey = keyof Adjustments;

export interface AdjSpec { key: AdjKey; label: string; min: number; max: number }
const s = (key: AdjKey, label: string, min = -100, max = 100): AdjSpec => ({ key, label, min, max });

export const ADJ_GROUPS: { title: string; items: AdjSpec[] }[] = [
  { title: "Light", items: [s("exposure", "Exposure"), s("brightness", "Brightness"), s("contrast", "Contrast"), s("highlights", "Highlights"), s("shadows", "Shadows"), s("whites", "Whites"), s("blacks", "Blacks"), s("gamma", "Gamma")] },
  { title: "Colour", items: [s("temperature", "Temperature"), s("tint", "Tint"), s("saturation", "Saturation"), s("vibrance", "Vibrance")] },
  { title: "Detail", items: [s("clarity", "Clarity"), s("sharpness", "Sharpness", 0, 100), s("dehaze", "Dehaze")] },
  { title: "Effects", items: [s("vignette", "Vignette"), s("grain", "Grain", 0, 100)] },
];

export const GRADE_GROUP: AdjSpec[] = [s("lift", "Lift"), s("gamma", "Gamma"), s("gain", "Gain"), s("red", "Red"), s("green", "Green"), s("blue", "Blue")];

export const isDefaultAdj = (a: Adjustments) => (Object.keys(DEFAULT_ADJ) as AdjKey[]).every((k) => a[k] === 0);

/** A "look" is a second colour stage blended over the corrected image by `intensity`. */
export interface LookParams {
  exposure: number; contrast: number; saturation: number; temperature: number; tint: number;
  fade: number; gray: number; split: number;
  shadowTint: [number, number, number]; highTint: [number, number, number];
  vignette: number; grain: number;
}
export interface Look { id: string; name: string; category: string; p: Partial<LookParams> }
export const DEFAULT_LOOK: LookParams = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, fade: 0, gray: 0, split: 0,
  shadowTint: [0.5, 0.5, 0.5], highTint: [0.5, 0.5, 0.5], vignette: 0, grain: 0,
};

const TEAL: [number, number, number] = [0.25, 0.55, 0.65];
const ORANGE: [number, number, number] = [0.75, 0.55, 0.3];
const BLUE: [number, number, number] = [0.3, 0.42, 0.75];
const GOLD: [number, number, number] = [0.78, 0.62, 0.32];
const ROSE: [number, number, number] = [0.72, 0.45, 0.52];
const GREEN: [number, number, number] = [0.38, 0.58, 0.4];
const PURPLE: [number, number, number] = [0.5, 0.35, 0.7];

export const LOOKS: Look[] = [
  { id: "cine-teal", name: "Teal & Orange", category: "Cinematic", p: { contrast: 0.18, saturation: 0.05, split: 0.35, shadowTint: TEAL, highTint: ORANGE, vignette: 0.25 } },
  { id: "cine-block", name: "Blockbuster", category: "Cinematic", p: { contrast: 0.3, saturation: -0.1, split: 0.25, shadowTint: BLUE, highTint: GOLD, vignette: 0.35 } },
  { id: "cine-night", name: "Night Drive", category: "Cinematic", p: { exposure: -0.15, contrast: 0.22, temperature: -0.3, split: 0.3, shadowTint: PURPLE, highTint: TEAL, vignette: 0.4 } },
  { id: "vint-70", name: "Seventies", category: "Vintage", p: { fade: 0.5, saturation: -0.15, temperature: 0.35, split: 0.2, shadowTint: GREEN, highTint: GOLD, grain: 0.3 } },
  { id: "vint-polar", name: "Instant", category: "Vintage", p: { fade: 0.65, contrast: -0.1, temperature: 0.15, tint: 0.1, split: 0.2, shadowTint: BLUE, highTint: GOLD, vignette: 0.2 } },
  { id: "vint-sepia", name: "Sepia", category: "Vintage", p: { gray: 1, split: 0.5, shadowTint: [0.6, 0.48, 0.34], highTint: [0.72, 0.6, 0.42], fade: 0.25, grain: 0.2 } },
  { id: "film-port", name: "Portra", category: "Film", p: { contrast: 0.08, saturation: -0.08, temperature: 0.12, fade: 0.2, split: 0.15, shadowTint: GREEN, highTint: ROSE, grain: 0.18 } },
  { id: "film-velv", name: "Velvia", category: "Film", p: { contrast: 0.22, saturation: 0.4, split: 0.1, shadowTint: BLUE, highTint: GOLD } },
  { id: "film-kod", name: "Gold 200", category: "Film", p: { contrast: 0.12, saturation: 0.12, temperature: 0.28, fade: 0.12, grain: 0.22 } },
  { id: "port-soft", name: "Soft Skin", category: "Portrait", p: { contrast: -0.08, saturation: -0.05, temperature: 0.1, exposure: 0.1, fade: 0.12 } },
  { id: "port-glow", name: "Golden Hour", category: "Portrait", p: { temperature: 0.4, saturation: 0.1, split: 0.2, shadowTint: ROSE, highTint: GOLD, contrast: 0.05 } },
  { id: "port-studio", name: "Studio", category: "Portrait", p: { contrast: 0.15, saturation: -0.12, vignette: 0.3, exposure: 0.05 } },
  { id: "land-vivid", name: "Vivid", category: "Landscape", p: { contrast: 0.18, saturation: 0.35 } },
  { id: "land-forest", name: "Forest", category: "Landscape", p: { contrast: 0.12, saturation: 0.15, split: 0.25, shadowTint: GREEN, highTint: GOLD, temperature: -0.05 } },
  { id: "land-alpine", name: "Alpine", category: "Landscape", p: { contrast: 0.2, saturation: 0.1, temperature: -0.2, split: 0.15, shadowTint: BLUE, highTint: [0.6, 0.6, 0.62] } },
  { id: "bw-classic", name: "Classic", category: "Black & White", p: { gray: 1, contrast: 0.12 } },
  { id: "bw-noir", name: "Noir", category: "Black & White", p: { gray: 1, contrast: 0.45, exposure: -0.1, vignette: 0.45, grain: 0.25 } },
  { id: "bw-silver", name: "Silver", category: "Black & White", p: { gray: 1, contrast: -0.05, fade: 0.3, split: 0.12, shadowTint: BLUE, highTint: [0.55, 0.55, 0.58] } },
  { id: "warm-sun", name: "Sunlit", category: "Warm", p: { temperature: 0.45, saturation: 0.08, exposure: 0.08 } },
  { id: "warm-amber", name: "Amber", category: "Warm", p: { temperature: 0.3, tint: 0.08, contrast: 0.12, split: 0.25, shadowTint: [0.62, 0.45, 0.35], highTint: GOLD } },
  { id: "warm-terra", name: "Terracotta", category: "Warm", p: { temperature: 0.25, saturation: -0.1, fade: 0.2, split: 0.3, shadowTint: [0.65, 0.42, 0.35], highTint: [0.75, 0.6, 0.45] } },
  { id: "cool-arctic", name: "Arctic", category: "Cool", p: { temperature: -0.45, saturation: -0.08, exposure: 0.05 } },
  { id: "cool-steel", name: "Steel", category: "Cool", p: { temperature: -0.25, saturation: -0.3, contrast: 0.2 } },
  { id: "cool-ocean", name: "Ocean", category: "Cool", p: { temperature: -0.2, split: 0.35, shadowTint: [0.2, 0.42, 0.7], highTint: TEAL, saturation: 0.1 } },
  { id: "mood-dusk", name: "Dusk", category: "Moody", p: { exposure: -0.25, contrast: 0.2, saturation: -0.25, split: 0.3, shadowTint: PURPLE, highTint: ROSE, vignette: 0.45 } },
  { id: "mood-fog", name: "Fog", category: "Moody", p: { fade: 0.55, saturation: -0.4, contrast: -0.08, temperature: -0.1 } },
  { id: "mood-ember", name: "Ember", category: "Moody", p: { exposure: -0.2, contrast: 0.32, saturation: -0.15, split: 0.3, shadowTint: [0.3, 0.38, 0.45], highTint: ORANGE, vignette: 0.5 } },
  { id: "lux-gold", name: "Gilded", category: "Luxury", p: { contrast: 0.2, saturation: -0.12, split: 0.35, shadowTint: [0.42, 0.42, 0.48], highTint: GOLD, vignette: 0.3 } },
  { id: "lux-onyx", name: "Onyx", category: "Luxury", p: { contrast: 0.38, saturation: -0.45, exposure: -0.08, vignette: 0.4 } },
  { id: "lux-pearl", name: "Pearl", category: "Luxury", p: { exposure: 0.15, contrast: -0.05, saturation: -0.2, fade: 0.18, split: 0.12, shadowTint: ROSE, highTint: [0.6, 0.58, 0.55] } },
  { id: "edit-matte", name: "Matte", category: "Editorial", p: { fade: 0.4, contrast: 0.1, saturation: -0.18 } },
  { id: "edit-crisp", name: "Crisp", category: "Editorial", p: { contrast: 0.28, saturation: -0.05, exposure: 0.05 } },
  { id: "edit-vogue", name: "Glossy", category: "Editorial", p: { contrast: 0.2, saturation: 0.12, split: 0.18, shadowTint: BLUE, highTint: ROSE } },
  { id: "soc-pop", name: "Pop", category: "Social Media", p: { contrast: 0.2, saturation: 0.3, exposure: 0.06 } },
  { id: "soc-clean", name: "Clean Feed", category: "Social Media", p: { exposure: 0.12, contrast: 0.06, saturation: -0.06, temperature: 0.06, fade: 0.1 } },
  { id: "soc-candy", name: "Candy", category: "Social Media", p: { saturation: 0.25, tint: 0.15, split: 0.25, shadowTint: PURPLE, highTint: ROSE, exposure: 0.08 } },
];

export const LOOK_CATEGORIES = [...new Set(LOOKS.map((l) => l.category))];
export const findLook = (id: string | null | undefined) => (id ? LOOKS.find((l) => l.id === id) : undefined);

export interface FilterRef { id: string | null; intensity: number }
export const NO_FILTER: FilterRef = { id: null, intensity: 100 };
