"use client";

import { useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Uploads straight from the browser to a private Supabase Storage bucket
 * under the signed-in user's own folder (owner-path RLS enforces isolation),
 * then writes the resulting storage PATH into a hidden form input so the
 * surrounding server-action form can persist it.
 *
 * Images are downscaled client-side before upload (NotifEyes FileField
 * pattern): max 1600px on the long edge, JPEG q0.82. PDFs pass through.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 8 * 1024 * 1024;

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("compression failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

export function FileUpload({
  bucket,
  userId,
  pathPrefix,
  name,
  accept = "image/jpeg,image/png,image/webp",
  label = "Upload file",
  currentFileName,
}: {
  bucket: "credentials" | "portfolios" | "avatars" | "org-media";
  userId: string;
  /** First path segment; defaults to userId (owner-path RLS). org-media keys on the org id instead. */
  pathPrefix?: string;
  /** Hidden input name the storage path is written to (read by the server action). */
  name: string;
  accept?: string;
  label?: string;
  currentFileName?: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>(currentFileName ?? "");
  const [path, setPath] = useState("");
  const fileNameRef = useRef("");

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setMessage(`Uploading ${file.name}…`);
    try {
      const isImage = file.type.startsWith("image/");
      const body = isImage ? await compressImage(file) : file;
      if (body.size > MAX_BYTES) throw new Error("File is too large (8 MB max).");

      const ext = isImage ? "jpg" : (file.name.split(".").pop() ?? "bin").toLowerCase();
      const objectPath = `${pathPrefix ?? userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await getSupabaseBrowser()
        .storage.from(bucket)
        .upload(objectPath, body, {
          contentType: isImage ? "image/jpeg" : file.type,
          upsert: false,
        });
      if (error) throw error;

      fileNameRef.current = file.name;
      setPath(objectPath);
      setStatus("done");
      setMessage(`${file.name} ✓`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Upload failed — try again.");
    }
  }

  return (
    <div>
      <label className="oc-btn-secondary cursor-pointer">
        {label}
        <input type="file" accept={accept} className="sr-only" onChange={onChange} />
      </label>
      <input type="hidden" name={name} value={path} />
      <input type="hidden" name={`${name}_filename`} value={fileNameRef.current} />
      {message ? (
        <p
          className={`mt-2 text-sm ${
            status === "error" ? "text-danger" : status === "done" ? "text-success" : "text-ink-soft"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
