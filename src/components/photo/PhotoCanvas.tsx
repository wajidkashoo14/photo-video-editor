"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui";
import { getBitmap, getImage, newBitmap, onAssetsChanged } from "@/lib/assets";
import { addImageFiles } from "@/lib/photo/actions";
import { flattenDoc, forgetLayer, renderDoc } from "@/lib/photo/render";
import { hitLayer, makePaintLayer, makeShapeLayer, makeTextLayer, type Layer } from "@/lib/photo/types";
import { clamp, makeCanvas } from "@/lib/utils";
import { usePhoto, type CropRect } from "@/stores/photoStore";

type Pt = { x: number; y: number };
type Handle = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };
const HANDLES: Handle[] = [
  { sx: -1, sy: -1 }, { sx: 0, sy: -1 }, { sx: 1, sy: -1 }, { sx: 1, sy: 0 },
  { sx: 1, sy: 1 }, { sx: 0, sy: 1 }, { sx: -1, sy: 1 }, { sx: -1, sy: 0 },
];
const ROTATE_OFFSET = 26;

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; id: string; p0: Pt; start: Layer; moved: boolean }
  | { kind: "scale"; id: string; h: Handle; start: Layer; moved: boolean }
  | { kind: "rotate"; id: string; start: Layer; a0: number; moved: boolean }
  | { kind: "stroke"; mode: "brush" | "eraser" | "clone"; layerId: string; base: HTMLCanvasElement; work: HTMLCanvasElement; pts: Pt[]; flat?: HTMLCanvasElement; tmp?: HTMLCanvasElement; off?: Pt }
  | { kind: "crop"; h: Handle | "move"; start: CropRect; p0: Pt };

const rad = (d: number) => (d * Math.PI) / 180;
const localToDoc = (l: Layer, lx: number, ly: number): Pt => {
  const r = rad(l.rotation);
  return { x: l.x + lx * Math.cos(r) - ly * Math.sin(r), y: l.y + lx * Math.sin(r) + ly * Math.cos(r) };
};

function scaleLayer(start: Layer, h: Handle, p: Pt, keepAspect: boolean) {
  const r = rad(start.rotation), cos = Math.cos(r), sin = Math.sin(r);
  const anchor = localToDoc(start, (-h.sx * start.w) / 2, (-h.sy * start.h) / 2);
  const dx = p.x - anchor.x, dy = p.y - anchor.y;
  const vx = dx * cos + dy * sin, vy = -dx * sin + dy * cos;
  let w = h.sx ? Math.max(4, vx * h.sx) : start.w;
  let hh = h.sy ? Math.max(4, vy * h.sy) : start.h;
  if (keepAspect && h.sx && h.sy) {
    const k = Math.max(w / start.w, hh / start.h);
    w = start.w * k;
    hh = start.h * k;
  }
  const cx = (h.sx * w) / 2, cy = (h.sy * hh) / 2;
  return { w, h: hh, x: anchor.x + cx * cos - cy * sin, y: anchor.y + cx * sin + cy * cos };
}

/** Sets a transform so that drawing in document coordinates lands on a layer's bitmap. */
function docToBitmap(ctx: CanvasRenderingContext2D, l: Layer, c: HTMLCanvasElement) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale((c.width / l.w) * (l.flipX ? -1 : 1), (c.height / l.h) * (l.flipY ? -1 : 1));
  ctx.rotate(-rad(l.rotation));
  ctx.translate(-l.x, -l.y);
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], size: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export function PhotoCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointer = useRef<Pt | null>(null);
  const space = useRef(false);
  const cloneSrc = useRef<Pt | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const checker = (() => {
      const c = makeCanvas(16, 16);
      const x = c.getContext("2d")!;
      x.fillStyle = "#2b2b34";
      x.fillRect(0, 0, 16, 16);
      x.fillStyle = "#1f1f27";
      x.fillRect(0, 0, 8, 8);
      x.fillRect(8, 8, 8, 8);
      return ctx.createPattern(c, "repeat")!;
    })();

    const S = () => usePhoto.getState();
    const toDoc = (e: { clientX: number; clientY: number }): Pt => {
      const r = canvas.getBoundingClientRect();
      const v = S().view;
      return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom };
    };
    const toScreen = (p: Pt): Pt => {
      const v = S().view;
      return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
    };
    const selected = () => S().doc.layers.find((l) => l.id === S().selectedId) ?? null;

    const fit = () => {
      const { doc } = S();
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      if (!cw || !ch) return;
      const zoom = Math.min((cw - 96) / doc.width, (ch - 96) / doc.height, 8);
      S().set({ view: { zoom, x: (cw - doc.width * zoom) / 2, y: (ch - doc.height * zoom) / 2 } });
    };

    const handlePoints = (l: Layer) => {
      const onlyCorners = l.type === "text";
      return HANDLES.filter((h) => !onlyCorners || (h.sx && h.sy)).map((h) => ({ h, p: toScreen(localToDoc(l, (h.sx * l.w) / 2, (h.sy * l.h) / 2)) }));
    };
    const rotatePoint = (l: Layer) => {
      const top = toScreen(localToDoc(l, 0, -l.h / 2));
      const r = rad(l.rotation);
      return { x: top.x + Math.sin(r) * ROTATE_OFFSET, y: top.y - Math.cos(r) * ROTATE_OFFSET };
    };
    const cropHandles = (c: CropRect) => HANDLES.map((h) => ({ h, p: toScreen({ x: c.x + ((h.sx + 1) / 2) * c.w, y: c.y + ((h.sy + 1) / 2) * c.h }) }));

    const draw = () => {
      raf.current = 0;
      const s = S();
      const { doc, view } = s;
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const k = view.zoom * dpr;
      ctx.setTransform(k, 0, 0, k, view.x * dpr, view.y * dpr);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, doc.width, doc.height);
      ctx.clip();
      checker.setTransform(new DOMMatrix().scale(1 / k));
      ctx.fillStyle = checker;
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.imageSmoothingEnabled = view.zoom < 4;
      renderDoc(ctx, doc, { preview: true, bypassAdjust: s.compare, scale: k });
      ctx.restore();

      // Overlays in CSS pixel space
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const accent = "#8f82ff";
      const sel = selected();
      if (sel && s.tool === "move" && !s.crop) {
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toScreen(localToDoc(sel, (a * sel.w) / 2, (b * sel.h) / 2)));
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        if (!sel.locked) {
          const rp = rotatePoint(sel);
          const top = toScreen(localToDoc(sel, 0, -sel.h / 2));
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(rp.x, rp.y);
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          for (const { p } of handlePoints(sel)) {
            ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
            ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
          }
        }
      }
      if (s.crop) {
        const a = toScreen({ x: s.crop.x, y: s.crop.y });
        const w = s.crop.w * view.zoom, h = s.crop.h * view.zoom;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        ctx.rect(a.x, a.y, w, h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        for (let i = 1; i < 3; i++) {
          ctx.moveTo(a.x + (w * i) / 3, a.y);
          ctx.lineTo(a.x + (w * i) / 3, a.y + h);
          ctx.moveTo(a.x, a.y + (h * i) / 3);
          ctx.lineTo(a.x + w, a.y + (h * i) / 3);
        }
        ctx.stroke();
        ctx.fillStyle = "#fff";
        for (const { p } of cropHandles(s.crop)) ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      }
      const brushing = s.tool === "brush" || s.tool === "eraser" || s.tool === "clone";
      if (brushing && pointer.current) {
        const p = toScreen(pointer.current);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, (s.brush.size * view.zoom) / 2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, (s.brush.size * view.zoom) / 2) + 1, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (s.tool === "clone" && cloneSrc.current) {
        const p = toScreen(cloneSrc.current);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y);
        ctx.lineTo(p.x + 8, p.y);
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x, p.y + 8);
        ctx.stroke();
      }
    };
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(draw);
    };

    /* ----- strokes ----- */
    const redrawStroke = (d: Extract<Drag, { kind: "stroke" }>) => {
      const s = S();
      const layer = s.doc.layers.find((l) => l.id === d.layerId);
      if (!layer) return;
      const w = d.work.getContext("2d")!;
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalAlpha = 1;
      w.globalCompositeOperation = "copy";
      w.drawImage(d.base, 0, 0);
      if (d.mode === "clone" && d.flat && d.tmp && d.off) {
        const t = d.tmp.getContext("2d")!;
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = "source-over";
        t.clearRect(0, 0, d.tmp.width, d.tmp.height);
        docToBitmap(t, layer, d.tmp);
        t.strokeStyle = "#000";
        tracePath(t, d.pts, s.brush.size);
        t.globalCompositeOperation = "source-in";
        // Source pixels are shifted so the sampled point lands under the brush.
        t.drawImage(d.flat, d.off.x, d.off.y, s.doc.width, s.doc.height);
        w.globalCompositeOperation = "source-over";
        w.globalAlpha = s.brush.opacity;
        w.drawImage(d.tmp, 0, 0);
      } else {
        docToBitmap(w, layer, d.work);
        w.globalCompositeOperation = d.mode === "eraser" ? "destination-out" : "source-over";
        w.globalAlpha = s.brush.opacity;
        w.strokeStyle = d.mode === "eraser" ? "#000" : s.brush.color;
        tracePath(w, d.pts, s.brush.size);
      }
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalAlpha = 1;
      w.globalCompositeOperation = "source-over";
      forgetLayer(layer.id);
      schedule();
    };

    const beginStroke = (mode: "brush" | "eraser" | "clone", p: Pt): Drag | null => {
      const s = S();
      let layer = selected();
      if (layer?.locked) {
        toast("This layer is locked.", "error");
        return null;
      }
      if (mode === "clone" && !cloneSrc.current) {
        toast("Alt-click to choose the area to clone from first.");
        return null;
      }
      if (mode === "eraser") {
        if (!layer || (layer.type !== "image" && layer.type !== "paint")) {
          toast("Select an image or paint layer to erase.");
          return null;
        }
      } else if (!layer || layer.type !== "paint") {
        // Paint goes on its own raster layer so the pixels underneath are never altered.
        const scale = Math.min(1, 4096 / Math.max(s.doc.width, s.doc.height));
        const { id } = newBitmap(s.doc.width * scale, s.doc.height * scale);
        const pl = makePaintLayer(s.doc, id);
        if (mode === "clone") pl.name = "Clone";
        s.addLayer(pl);
        layer = pl;
      }
      let flat: HTMLCanvasElement | undefined;
      if (mode === "clone") flat = flattenDoc(s.doc, Math.min(1, 2048 / Math.max(s.doc.width, s.doc.height)), true);
      S().snapshot();
      let base: HTMLCanvasElement | undefined;
      let work: HTMLCanvasElement;
      if (layer.type === "paint") {
        base = getBitmap(layer.bitmapId);
        if (!base) return null;
        const nb = newBitmap(base.width, base.height, base);
        work = nb.canvas;
        S().updateLayer(layer.id, { bitmapId: nb.id }, false);
      } else if (layer.type === "image") {
        const img = getImage(layer.assetId);
        if (!img) return null;
        base = layer.maskId ? getBitmap(layer.maskId) : newBitmap(img.preview.width, img.preview.height, undefined, "#fff").canvas;
        if (!base) return null;
        const nb = newBitmap(base.width, base.height, base);
        work = nb.canvas;
        S().updateLayer(layer.id, { maskId: nb.id }, false);
      } else return null;
      const d: Drag = {
        kind: "stroke", mode, layerId: layer.id, base, work, pts: [p], flat,
        tmp: mode === "clone" ? makeCanvas(work.width, work.height) : undefined,
        off: mode === "clone" ? { x: p.x - cloneSrc.current!.x, y: p.y - cloneSrc.current!.y } : undefined,
      };
      redrawStroke(d);
      return d;
    };

    /* ----- pointer ----- */
    const near = (a: Pt, b: Pt, r = 9) => Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r;

    const down = (e: PointerEvent) => {
      const s = S();
      const p = toDoc(e);
      const r = canvas.getBoundingClientRect();
      const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || space.current || s.tool === "hand") {
        drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y };
        return;
      }
      if (e.button !== 0) return;
      if (s.tool === "crop" && s.crop) {
        const hit = cropHandles(s.crop).find((h) => near(h.p, sp));
        if (hit) drag.current = { kind: "crop", h: hit.h, start: s.crop, p0: p };
        else if (p.x > s.crop.x && p.x < s.crop.x + s.crop.w && p.y > s.crop.y && p.y < s.crop.y + s.crop.h) drag.current = { kind: "crop", h: "move", start: s.crop, p0: p };
        return;
      }
      if (s.tool === "move") {
        const sel = selected();
        if (sel && !sel.locked) {
          if (near(rotatePoint(sel), sp)) {
            drag.current = { kind: "rotate", id: sel.id, start: sel, a0: Math.atan2(p.y - sel.y, p.x - sel.x), moved: false };
            return;
          }
          const hh = handlePoints(sel).find((h) => near(h.p, sp));
          if (hh) {
            drag.current = { kind: "scale", id: sel.id, h: hh.h, start: sel, moved: false };
            return;
          }
        }
        const hit = hitLayer(s.doc, p.x, p.y);
        s.set({ selectedId: hit?.id ?? null });
        if (hit) drag.current = { kind: "move", id: hit.id, p0: p, start: hit, moved: false };
        return;
      }
      if (s.tool === "text") {
        s.addLayer(makeTextLayer(s.doc, p.x, p.y));
        s.set({ tool: "move" });
        return;
      }
      if (s.tool === "shape") {
        s.addLayer(makeShapeLayer(s.doc, s.shapeKind, p.x, p.y));
        s.set({ tool: "move" });
        return;
      }
      if (s.tool === "clone" && e.altKey) {
        cloneSrc.current = p;
        schedule();
        return;
      }
      if (s.tool === "brush" || s.tool === "eraser" || s.tool === "clone") drag.current = beginStroke(s.tool, p);
    };

    const move = (e: PointerEvent) => {
      const s = S();
      const p = toDoc(e);
      pointer.current = p;
      const d = drag.current;
      if (!d) {
        if (s.tool === "brush" || s.tool === "eraser" || s.tool === "clone") schedule();
        return;
      }
      if (d.kind === "pan") {
        s.set({ view: { ...s.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy } });
      } else if (d.kind === "move") {
        if (!d.moved) {
          if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) * s.view.zoom < 3) return;
          s.snapshot();
          d.moved = true;
        }
        let x = d.start.x + p.x - d.p0.x, y = d.start.y + p.y - d.p0.y;
        // Snap the layer centre to the document centre lines.
        const tol = 6 / s.view.zoom;
        if (!e.altKey) {
          if (Math.abs(x - s.doc.width / 2) < tol) x = s.doc.width / 2;
          if (Math.abs(y - s.doc.height / 2) < tol) y = s.doc.height / 2;
        }
        if (e.shiftKey) {
          if (Math.abs(p.x - d.p0.x) > Math.abs(p.y - d.p0.y)) y = d.start.y;
          else x = d.start.x;
        }
        s.updateLayer(d.id, { x, y }, false);
      } else if (d.kind === "scale") {
        if (!d.moved) {
          s.snapshot();
          d.moved = true;
        }
        const st = d.start;
        const keep = st.type === "text" || (st.type === "image" ? !e.shiftKey : e.shiftKey);
        const n = scaleLayer(st, d.h, p, keep);
        if (st.type === "text") {
          const k = n.w / st.w;
          s.updateLayer(d.id, { x: n.x, y: n.y, style: { ...st.style, fontSize: Math.max(4, st.style.fontSize * k), bgPadding: st.style.bgPadding * k, strokeWidth: st.style.strokeWidth * k } } as Partial<Layer>, false);
        } else s.updateLayer(d.id, n, false);
      } else if (d.kind === "rotate") {
        if (!d.moved) {
          s.snapshot();
          d.moved = true;
        }
        let deg = d.start.rotation + ((Math.atan2(p.y - d.start.y, p.x - d.start.x) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        s.updateLayer(d.id, { rotation: deg }, false);
      } else if (d.kind === "stroke") {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * s.view.zoom < 1.5) return;
        d.pts.push(p);
        redrawStroke(d);
      } else if (d.kind === "crop") {
        const c = d.start, W = s.doc.width, H = s.doc.height;
        const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
        let n: CropRect;
        if (d.h === "move") n = { ...c, x: clamp(c.x + dx, 0, W - c.w), y: clamp(c.y + dy, 0, H - c.h) };
        else {
          let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
          if (d.h.sx < 0) x0 = clamp(x0 + dx, 0, x1 - 8);
          if (d.h.sx > 0) x1 = clamp(x1 + dx, x0 + 8, W);
          if (d.h.sy < 0) y0 = clamp(y0 + dy, 0, y1 - 8);
          if (d.h.sy > 0) y1 = clamp(y1 + dy, y0 + 8, H);
          const a = s.cropAspect;
          if (a) {
            // Keep the requested ratio by deriving the other dimension, anchored on the fixed edge.
            if (d.h.sx !== 0) {
              const h = Math.min((x1 - x0) / a, d.h.sy < 0 ? y1 : H - y0);
              const w = h * a;
              if (d.h.sx < 0) x0 = x1 - w; else x1 = x0 + w;
              if (d.h.sy < 0) y0 = y1 - h; else y1 = y0 + h;
            } else {
              const w = Math.min((y1 - y0) * a, W - x0);
              x1 = x0 + w;
              if (d.h.sy < 0) y0 = y1 - w / a; else y1 = y0 + w / a;
            }
          }
          n = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        s.set({ crop: n });
      }
    };

    const up = () => {
      drag.current = null;
    };
    const leave = () => {
      pointer.current = null;
      schedule();
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = S();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const zoom = clamp(s.view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0.02, 32);
      const k = zoom / s.view.zoom;
      s.set({ view: { zoom, x: mx - (mx - s.view.x) * k, y: my - (my - s.view.y) * k } });
    };

    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input,textarea,select")) {
        space.current = e.type === "keydown";
        canvas.style.cursor = space.current ? "grab" : "";
        if (e.type === "keydown") e.preventDefault();
      }
    };

    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) addImageFiles(e.dataTransfer.files).then((errs) => errs.forEach((m) => toast(m, "error")));
    };
    const over = (e: DragEvent) => e.preventDefault();

    let lastFit = S().fitNonce;
    const unsub = usePhoto.subscribe((s) => {
      if (s.fitNonce !== lastFit) {
        lastFit = s.fitNonce;
        fit();
      }
      schedule();
    });
    const unAssets = onAssetsChanged(schedule);
    const ro = new ResizeObserver(() => {
      if (S().view.zoom === 1 && S().view.x === 0) fit();
      schedule();
    });
    ro.observe(wrap);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    wrap.addEventListener("drop", drop);
    wrap.addEventListener("dragover", over);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    fit();
    schedule();
    return () => {
      unsub();
      unAssets();
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0; // otherwise a remount (StrictMode) would think a frame is still pending
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      wrap.removeEventListener("drop", drop);
      wrap.removeEventListener("dragover", over);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, []);

  const tool = usePhoto((s) => s.tool);
  const cursor = tool === "hand" ? "grab" : tool === "move" ? "default" : tool === "text" ? "text" : tool === "brush" || tool === "eraser" || tool === "clone" ? "none" : "crosshair";
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-bg">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" style={{ cursor }} />
    </div>
  );
}

