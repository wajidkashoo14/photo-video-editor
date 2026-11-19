export const ASPECTS: { label: string; value: number | null | "original" }[] = [
  { label: "Free", value: null },
  { label: "Original", value: "original" },
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
];

export interface SizePreset {
  id: string;
  platform: string;
  name: string;
  width: number;
  height: number;
  kind: "photo" | "video";
  fps?: number;
}

const p = (platform: string, name: string, width: number, height: number, kind: "photo" | "video" = "photo", fps?: number): SizePreset => ({
  id: `${platform}-${name}`.toLowerCase().replace(/\W+/g, "-"), platform, name, width, height, kind, fps,
});

export const SOCIAL_PRESETS: SizePreset[] = [
  p("Instagram", "Post", 1080, 1080),
  p("Instagram", "Portrait Post", 1080, 1350),
  p("Instagram", "Story", 1080, 1920),
  p("Instagram", "Reel", 1080, 1920, "video", 30),
  p("Facebook", "Post", 1200, 630),
  p("Facebook", "Story", 1080, 1920),
  p("Facebook", "Video", 1920, 1080, "video", 30),
  p("YouTube", "Thumbnail", 1280, 720),
  p("YouTube", "Short", 1080, 1920, "video", 30),
  p("YouTube", "Video", 1920, 1080, "video", 30),
  p("TikTok", "Vertical Video", 1080, 1920, "video", 30),
  p("LinkedIn", "Post", 1200, 627),
  p("LinkedIn", "Banner", 1584, 396),
  p("Pinterest", "Pin", 1000, 1500),
];

export interface MarketPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  /** Fraction of the frame the product should fill (longest side). */
  fill: number;
  format: "jpeg" | "png" | "webp";
  note: string;
}

export const MARKET_PRESETS: MarketPreset[] = [
  { id: "amazon", name: "Amazon", width: 2000, height: 2000, background: "#ffffff", fill: 0.85, format: "jpeg", note: "Pure white, product fills 85% of a 2000 px square" },
  { id: "etsy", name: "Etsy", width: 2700, height: 2025, background: "#f6f3ee", fill: 0.78, format: "jpeg", note: "4:3 landscape, 2700 px wide" },
  { id: "shopify", name: "Shopify", width: 2048, height: 2048, background: "#ffffff", fill: 0.8, format: "jpeg", note: "2048 px square" },
  { id: "instagram", name: "Instagram", width: 1080, height: 1350, background: "#efece6", fill: 0.72, format: "jpeg", note: "4:5 portrait feed post" },
  { id: "web", name: "Website gallery", width: 1600, height: 1600, background: "transparent", fill: 0.86, format: "webp", note: "Transparent WebP, 1600 px square" },
];
