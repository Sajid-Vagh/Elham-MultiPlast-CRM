import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = "/api/voice-notes";

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

export interface VoiceNoteData {
  id: number;
  dealId: number | null;
  productionOrderId: number | null;
  proformaInvoiceId: number | null;
  orderId: number | null;
  leadId: number | null;
  customerId: number | null;
  uploadedById: number;
  createdByRole: string;
  uploadedByName: string | null;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string;
  durationMs: number | null;
  transcript: string | null;
  transcriptStatus: string;
  isReplaced: boolean;
  fileAvailable: boolean;
  createdAt: string;
}

export type VoiceNoteEntityType = "deal" | "production" | "order" | "lead" | "customer" | "proforma";

function getQueryKey(entityType: VoiceNoteEntityType, entityId: number | string) {
  return ["voice-notes", entityType, entityId];
}

// ──────────────────────────────────────────
// Fetch voice notes for any entity
// ──────────────────────────────────────────
export function useVoiceNotes(entityType: VoiceNoteEntityType | null, entityId: number | null | undefined) {
  return useQuery<VoiceNoteData[]>({
    queryKey: getQueryKey(entityType!, entityId!),
    queryFn: async () => {
      const res = await fetch(`${API}?type=${entityType}&id=${entityId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch voice notes");
      return res.json();
    },
    enabled: !!entityType && !!entityId,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
}

// ──────────────────────────────────────────
// Upload a voice note
// ──────────────────────────────────────────
export function useUploadVoiceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      file: Blob;
      entityType: VoiceNoteEntityType;
      entityId: number;
      transcript?: string;
      durationMs?: number;
      fileName?: string;
    }) => {
      const formData = new FormData();
      formData.append("file", params.file, params.fileName || `voice-note-${Date.now()}.webm`);
      formData.append("entityType", params.entityType);
      formData.append("entityId", String(params.entityId));
      if (params.transcript) formData.append("transcript", params.transcript);
      if (params.durationMs) formData.append("durationMs", String(params.durationMs));

      const res = await fetch(API, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json() as Promise<VoiceNoteData>;
    },
  });
}

// ──────────────────────────────────────────
// Delete a voice note
// ──────────────────────────────────────────
export function useDeleteVoiceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API}/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete voice note");
      return res.json();
    },
  });
}

// ──────────────────────────────────────────
// Download a voice note
// ──────────────────────────────────────────
export function downloadVoiceNote(id: number, fileName: string) {
  const a = document.createElement("a");
  a.href = `${API}/${id}/download`;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ──────────────────────────────────────────
// Replace a voice note
// ──────────────────────────────────────────
export function useReplaceVoiceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      id: number;
      file: Blob;
      transcript?: string;
      durationMs?: number;
    }) => {
      const formData = new FormData();
      formData.append("file", params.file, `voice-note-${Date.now()}.webm`);
      if (params.transcript) formData.append("transcript", params.transcript);
      if (params.durationMs) formData.append("durationMs", String(params.durationMs));

      const res = await fetch(`${API}/${params.id}/replace`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to replace voice note");
      return res.json() as Promise<VoiceNoteData>;
    },
  });
}

// ──────────────────────────────────────────
// Get query key for invalidation
// ──────────────────────────────────────────
export function getVoiceNotesQueryKey(entityType: VoiceNoteEntityType, entityId: number | string) {
  return getQueryKey(entityType, entityId);
}
