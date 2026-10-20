"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Button, Modal, Segmented, Spinner, cx } from "./ui.jsx";

/**
 * Upload-history picker: previously uploaded images and generated images,
 * all stored server-side in R2, plus drag-and-drop upload of new ones.
 */
export default function MediaPicker({ open, onClose, onConfirm, max = 1, title = "Choose images", excludeIds = [] }) {
  const [source, setSource] = useState("upload");
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAssets(await api.listAssets({ kind: "image", source, limit: 120 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const toggle = (asset) => {
    setSelected((current) => {
      if (current.some((a) => a.id === asset.id)) return current.filter((a) => a.id !== asset.id);
      if (max === 1) return [asset];
      if (current.length >= max) return current;
      return [...current, asset];
    });
  };

  const upload = async (files) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploading(true);
    setError("");
    try {
      const uploaded = await api.uploadFiles(images);
      setSource("upload");
      setAssets((current) => [...uploaded, ...current.filter((a) => !uploaded.some((u) => u.id === a.id))]);
      setSelected((current) => [...current, ...uploaded].slice(0, max === 1 ? 1 : max));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const visible = assets.filter((a) => !excludeIds.includes(a.id));

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div
        className={cx("space-y-4", dragging && "outline-dashed outline-2 outline-primary")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: "upload", label: "Uploads" },
                { value: "generation", label: "Generated" },
              ]}
            />
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => upload(e.target.files)} />
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : "＋"} Upload images
          </Button>
          <span className="text-xs text-muted">or drop files here · {max > 1 ? `up to ${max}` : "pick one"}</span>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-secondary">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-muted">
            {source === "upload" ? "No uploads yet — upload or drop images." : "No generated images yet."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {visible.map((asset) => {
              const index = selected.findIndex((a) => a.id === asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggle(asset)}
                  className={cx(
                    "relative aspect-square overflow-hidden rounded-lg border-2 bg-black/40 transition",
                    index >= 0 ? "border-primary" : "border-transparent hover:border-white/30",
                  )}
                >
                  <img src={asset.url} alt={asset.originalName || ""} className="h-full w-full object-cover" loading="lazy" />
                  {index >= 0 && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-black">
                      {max > 1 ? index + 1 : "✓"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-white/[0.07] pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => {
              onConfirm(selected);
              onClose();
            }}
          >
            Use {selected.length > 1 ? `${selected.length} images` : "image"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
