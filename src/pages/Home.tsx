"use client";

import { useState, useEffect } from "react";
import Tesseract from "tesseract.js";
import Swal from "sweetalert2";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

// --- Interface Data ---
interface ApprovalData {
  hasil_cek: string;
  npsn: string;
  sn_bapp: string;
  nama_sekolah?: string;
  kode?: string;
}

interface ScanPair {
  front: string;
  back?: string;
  frontText?: string;
  backText?: string;
  docName?: string;
  ocrStatus?: "idle" | "processing" | "success" | "error";
  // New properties for approval status
  matchStatus?:
  | "idle"
  | "loading"
  | "matched"
  | "not-matched"
  | "ambiguous"
  | "error";
  approvalData?: ApprovalData[]; // Stores the list of potential matches
  selectedApproval?: ApprovalData; // Stores user-selected or auto-selected match
  isSaved?: boolean;
  isSaving?: boolean;
  frontRotation?: number; // 0, 90, 180, 270
  backRotation?: number;
  isRotating?: boolean;
}

// Helper to rotate base64 image
const rotateImageBase64 = (base64: string, degrees: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (degrees === 0) return resolve(base64);

    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context not available"));

      // Calculate new dimensions
      if (degrees === 90 || degrees === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Translate to center for rotation
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();

      resolve(canvas.toDataURL("image/jpeg", 0.9)); // Keep quality high
    };
    img.onerror = reject;
  });
};
interface ScanResponse {
  success: boolean;
  data?: ScanPair[];
  message?: string;
}

export default function Home() {
  const [scanResults, setScanResults] = useState<ScanPair[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [status, setStatus] = useState<{
    type: "idle" | "success" | "error" | "processing";
    msg: string;
  }>({
    type: "idle",
    msg: "",
  });

  // State for Image Preview Modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState<{
    index: number;
    property: "front" | "back"; // Property name in ScanPair
  } | null>(null);

  // View Mode State
  const [viewMode, setViewMode] = useState<"start" | "results">("start");

  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Initialize theme
  useEffect(() => {
    // Check local storage or system preference
    const storedTheme = localStorage.getItem("theme") as
      | "light"
      | "dark"
      | null;
    const systemPrefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    if (storedTheme) {
      setTheme(storedTheme);
      document.documentElement.classList.toggle("dark", storedTheme === "dark");
    } else if (systemPrefersDark) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Keyboard Navigation for Preview Modal
  useEffect(() => {
    if (!previewImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewImage(null);
        return;
      }

      // Find current image context
      const currentPair = scanResults.find(
        (p) => p.front === previewImage || p.back === previewImage
      );

      if (!currentPair) return;

      const isFront = currentPair.front === previewImage;

      // Navigate Left / A (Back -> Front)
      if ((e.key === "ArrowLeft" || e.key.toLowerCase() === "a") && !isFront) {
        setPreviewImage(currentPair.front);
      }

      // Navigate Right / D (Front -> Back)
      if ((e.key === "ArrowRight" || e.key.toLowerCase() === "d") && isFront && currentPair.back) {
        setPreviewImage(currentPair.back);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage, scanResults]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

  // Fetch profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      // Skip fetching profiles in mock mode
      if (import.meta.env.VITE_USE_MOCK === "true") {
        setProfiles(["Mock Profile 1", "Mock Profile 2"]);
        setProfileName("Mock Profile 1");
        return;
      }

      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/profiles`,
        );
        if (!res.ok) throw new Error("Failed to fetch profiles");
        const data = await res.json();
        if (data.success && data.profiles && Array.isArray(data.profiles)) {
          setProfiles(data.profiles);
          if (data.profiles.length > 0) {
            setProfileName(data.profiles[0]); // Set default to first profile
          }
        }
      } catch (err) {
        console.error("Error fetching profiles:", err);
        // Fallback or just keep empty
      }
    };

    fetchProfiles();
  }, []);
  const handleSave = async (index: number) => {
    const item = scanResults[index];

    // Cek apakah data sudah diverifikasi
    if (item.matchStatus !== "matched" || !item.selectedApproval) {
      Swal.fire({
        icon: "warning",
        title: "Belum Diverifikasi",
        text: "Silakan verifikasi data BAPP terlebih dahulu!",
      });
      return;
    }

    // VALIDASI: Cek apakah status SESUAI
    if (item.selectedApproval.hasil_cek !== "sesuai") {
      Swal.fire({
        icon: "error",
        title: "Data Tidak Sesuai",
        text: "Dokumen tidak dapat disimpan karena status verifikasi TIDAK SESUAI.",
      });
      return;
    }

    // Set loading state
    setScanResults((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isSaving: true };
      return updated;
    });

    try {
      // Apply rotation if needed before sending
      const processedFront = await rotateImageBase64(item.back || "", item.backRotation || 0);
      const processedBack = await rotateImageBase64(item.front || "", item.frontRotation || 0);

      const payload = {
        doc_name: item.docName || `Dokumen #${index + 1}`,
        npsn: item.selectedApproval.npsn,
        sn_bapp: item.selectedApproval.sn_bapp,
        hasil_cek: item.selectedApproval.hasil_cek,
        image_front: processedFront, // Base64 Front (UI "Depan" is item.back)
        image_back: processedBack, // Base64 Back (UI "Belakang" is item.front)
        nama_sekolah: item.selectedApproval.nama_sekolah,
        kode: item.selectedApproval.kode, // Added Kode
      };

      const res = await fetch(
        `${import.meta.env.VITE_SAVE_API_URL}/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result = await res.json();

      setScanResults((prev) => {
        const updated = [...prev];
        // Ensure index is still valid (basic check)
        if (updated[index]) {
          updated[index] = { ...updated[index], isSaving: false };
          if (result.success) {
            updated[index].isSaved = true;
          }
        }
        return updated;
      });

      if (result.success) {
        Swal.fire({
          icon: "success",
          title: "Berhasil",
          text: result.message,
          timer: 2000,
          showConfirmButton: false,
        });
      } else {
        Swal.fire({
          icon: "error",
          title: "Gagal Menyimpan",
          text: result.message,
        });
      }
    } catch (error) {
      console.error("Save error:", error);

      setScanResults((prev) => {
        const updated = [...prev];
        if (updated[index]) {
          updated[index] = { ...updated[index], isSaving: false };
        }
        return updated;
      });

      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Gagal menghubungi server. Pastikan aplikasi Bridge sudah jalan!",
      });
    }
  };
  const handleScan = async () => {
    setLoading(true);
    setStatus({ type: "idle", msg: "⏳ Menghubungkan ke Scanner..." });
    setScanResults([]);

    try {
      const isMock = import.meta.env.VITE_USE_MOCK === "true";
      const apiUrl = import.meta.env.VITE_API_URL;
      const saveApiUrl = import.meta.env.VITE_SAVE_API_URL; // Mock is on backend server

      const endpoint = isMock
        ? `${saveApiUrl}/mock-scan`
        : `${apiUrl}/scan?profile=${encodeURIComponent(profileName)}`;

      const response = await fetch(endpoint, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ScanResponse = await response.json();

      if (data.success && data.data) {
        setScanResults(data.data);
        setStatus({
          type: "success",
          msg: `✅ Scan Berhasil! ${data.data.length} dokumen ditemukan. Memulai OCR...`,
        });
        setViewMode("results"); // Switch to results view

        // --- TRIGGER AUTOMATIC OCR ---
        await processOcr(data.data);
      } else {
        setStatus({
          type: "error",
          msg: `❌ Gagal: ${data.message || "Unknown error"}`,
        });
      }
    } catch (error) {
      console.error(error);
      setStatus({
        type: "error",
        msg: "⚠️ Error: Pastikan aplikasi Bridge (.exe) sudah jalan!",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBackToStart = () => {
    setScanResults([]);
    setStatus({ type: "idle", msg: "" });
    setViewMode("start");
  };

  // --- OCR LOGIC ---

  // Reusable function to process a single item
  const processSingleItemOcr = async (
    item: ScanPair,
  ): Promise<{ text: string; detectedName: string | null }> => {
    // Only process Visual Front (which is item.back in data)
    if (!item.back) return { text: "", detectedName: null };

    try {
      const result = await Tesseract.recognize(item.back, "ind");
      const text = result.data.text;

      // Extract BAPP Number
      const match = text.match(/Nomor\s*[:]\s*[^A-Z0-9]*([A-Z0-9]+)/i);
      const detectedName = match && match[1] ? match[1] : null;

      return { text, detectedName };
    } catch (err) {
      console.error("OCR Error:", err);
      return { text: "(Gagal reading)", detectedName: null };
    }
  };

  const checkApproval = async (
    identifier: string,
    isNpsn: boolean = false,
  ): Promise<{
    status: ScanPair["matchStatus"];
    data: ApprovalData[];
    selected?: ApprovalData;
  }> => {
    if (!identifier) return { status: "idle", data: [] };

    try {
      const param = isNpsn ? `npsn=${encodeURIComponent(identifier)}` : `no_bapp=${encodeURIComponent(identifier)}`;
      const res = await fetch(
        `${import.meta.env.VITE_APPROVAL_API_URL}/is-approved?${param}`,
      );
      if (!res.ok) throw new Error("API Check Failed");

      const json = await res.json();
      // Expected json: { message: "Success", data: [...] }

      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        const list = json.data as ApprovalData[];

        if (list.length === 1) {
          // Perfect match
          return { status: "matched", data: list, selected: list[0] };
        } else {
          // Ambiguous / Duplicates
          return { status: "ambiguous", data: list };
        }
      } else {
        // No data match? assume not matched or not found
        // The user requirement says "jika belum akan tampil warning", assuming empty list means not found/not sesuai logic or just not in DB?
        // Let's assume empty data means "Not Found" essentially.
        // Wait, the prompt says "pastikan apakah bapp dengan no_bapp tersebut sudah sesuai... jika belum tampil warning"
        // If it returns empty, it's definitely "not-matched".
        return { status: "not-matched", data: [] };
      }
    } catch (err) {
      console.error("Check Approval Error:", err);
      return { status: "error", data: [] };
    }
  };

  const processOcr = async (scannedData: ScanPair[]) => {
    setStatus((prev) => ({
      ...prev,
      type: "processing",
      msg: "🔍 Sedang memproses OCR...",
    }));

    // Initialize OCR status for all items
    const updatedResults: ScanPair[] = scannedData.map((item) => ({
      ...item,
      ocrStatus: "processing",
    }));
    setScanResults([...updatedResults]); // Update UI to show processing

    for (let i = 0; i < updatedResults.length; i++) {
      // Skip if already has name (unless forced? na, initial run)
      const { text, detectedName } = await processSingleItemOcr(
        updatedResults[i],
      );

      updatedResults[i].backText = text;
      if (detectedName) {
        updatedResults[i].docName = detectedName;
        updatedResults[i].ocrStatus = "success";
      } else {
        updatedResults[i].docName = `Dokumen #${i + 1}`;
        updatedResults[i].ocrStatus = "error"; // Failed to extract name
        updatedResults[i].matchStatus = "idle";
      }

      setScanResults([...updatedResults]); // Update progressive

      // If we have a name, trigger approval check
      if (
        updatedResults[i].docName &&
        updatedResults[i].ocrStatus === "success"
      ) {
        updatedResults[i].matchStatus = "loading";
        setScanResults([...updatedResults]);

        const checkDetails = await checkApproval(updatedResults[i].docName!);

        updatedResults[i].matchStatus = checkDetails.status;
        updatedResults[i].approvalData = checkDetails.data;
        updatedResults[i].selectedApproval = checkDetails.selected;

        setScanResults([...updatedResults]);
      }
    }

    setStatus({
      type: "success",
      msg: `✅ Scan & OCR Selesai! ${updatedResults.length} dokumen diproses.`,
    });
  };

  const handleRetryOcr = async (index: number) => {
    setStatus({
      type: "processing",
      msg: `🔍 Mengulangi OCR untuk dokumen #${index + 1}...`,
    });

    // Set individual item status to processing
    const updatedResults = [...scanResults];
    updatedResults[index].ocrStatus = "processing";
    setScanResults(updatedResults);

    const { text, detectedName } = await processSingleItemOcr(
      updatedResults[index],
    );

    updatedResults[index].backText = text;
    if (detectedName) {
      updatedResults[index].docName = detectedName;
      updatedResults[index].ocrStatus = "success";
      setStatus({
        type: "success",
        msg: `✅ OCR Ulang Berhasil! Nama terdeteksi: ${detectedName}`,
      });
    } else {
      updatedResults[index].ocrStatus = "error";
      setStatus({
        type: "error",
        msg: `⚠️ OCR Ulang Selesai, tapi nomor tidak ditemukan.`,
      });
      updatedResults[index].matchStatus = "idle";
    }

    setScanResults([...updatedResults]);

    // Post-retry approval check
    if (detectedName) {
      updatedResults[index].matchStatus = "loading";
      setScanResults([...updatedResults]);

      const checkDetails = await checkApproval(detectedName);
      updatedResults[index].matchStatus = checkDetails.status;
      updatedResults[index].approvalData = checkDetails.data;
      updatedResults[index].selectedApproval = checkDetails.selected;

      setScanResults([...updatedResults]);
    }

    setScanResults(updatedResults);
  };

  const handleNameChange = (index: number, newName: string) => {
    const updated = [...scanResults];
    updated[index].docName = newName;
    // Reset approval status if name changes manually?
    // Maybe user fixed a typo, so we should probably re-check or let them click a "Check" button.
    // For now, let's reset to idle to avoid confusion.
    updated[index].matchStatus = "idle";
    updated[index].approvalData = [];
    updated[index].selectedApproval = undefined;
    setScanResults(updated);
  };

  const handleManualCheck = async (index: number, npsnInput?: string) => {
    const item = scanResults[index];
    if (!item.docName && !npsnInput) return;

    const updated = [...scanResults];
    updated[index].matchStatus = "loading";
    setScanResults(updated);

    // Use NPSN input if provided, otherwise fallback to existing logic (docName as no_bapp)
    const checkDetails = npsnInput
      ? await checkApproval(npsnInput, true)
      : await checkApproval(item.docName!);
    updated[index].matchStatus = checkDetails.status;
    updated[index].approvalData = checkDetails.data;
    updated[index].selectedApproval = checkDetails.selected;

    setScanResults([...updated]);
  };

  const handleSelectApproval = (index: number, selection: ApprovalData) => {
    const updated = [...scanResults];
    updated[index].selectedApproval = selection;
    // If they picked one, we consider it 'matched' effectively for UI logic,
    // but let's keep status as 'ambiguous' or switch to 'matched'?
    // Let's switch to 'matched' to show the green/red UI based on content.
    updated[index].matchStatus = "matched";
    setScanResults(updated);
  };

  const handleDelete = (index: number) => {
    Swal.fire({
      title: "Hapus Dokumen?",
      text: "Data hasil scan ini akan dihapus dari daftar.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Ya, Hapus",
      cancelButtonText: "Batal",
    }).then((result) => {
      if (result.isConfirmed) {
        const updated = [...scanResults];
        updated.splice(index, 1);
        setScanResults(updated);
        Swal.fire({
          title: "Terhapus!",
          text: "Dokumen telah dihapus.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false
        });

        // If no items left, go back to start?
        if (updated.length === 0) {
          setViewMode("start");
        }
      }
    });
  };

  const handleClearAll = () => {
    Swal.fire({
      title: "Hapus Semua Hasil?",
      text: "Semua data hasil scan akan dihapus dan tidak dapat dikembalikan.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Ya, Hapus Semua",
      cancelButtonText: "Batal",
    }).then((result) => {
      if (result.isConfirmed) {
        setScanResults([]);
        setViewMode("start");
        setStatus({ type: "idle", msg: "" });
        Swal.fire({
          title: "Bersih!",
          text: "Semua hasil scan telah dihapus.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false
        });
      }
    });
  };

  const handleRotate = async (index: number, property: "front" | "back") => {
    // Prevent multiple clicks
    if (scanResults[index].isRotating) return;

    setScanResults((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isRotating: true };
      return updated;
    });

    try {
      const item = scanResults[index];
      // Logic check: The UI maps "Depan" -> item.back and "Belakang" -> item.front
      // But we pass the property name ("back" or "front") directly from the UI loop.
      // So we just access item[property].

      const currentImg = item[property];

      if (currentImg) {
        // Rotate 90 degrees
        const newImg = await rotateImageBase64(currentImg, 90);

        setScanResults((prev) => {
          const updated = [...prev];
          const newItem = { ...updated[index], isRotating: false };

          // Update image
          if (property === "front") {
            newItem.front = newImg;
            newItem.frontRotation = 0; // Reset rotation since it's burnt in
          } else {
            newItem.back = newImg;
            newItem.backRotation = 0;
          }

          updated[index] = newItem;
          return updated;
        });
      }
    } catch (error) {
      console.error("Rotation failed:", error);
      setScanResults((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], isRotating: false };
        return updated;
      });
    }
  };

  // --- DRAG AND DROP HANDLERS ---
  const handleDragStart = (
    index: number,
    property: "front" | "back"
  ) => {
    setDraggedItem({ index, property });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Allow dropping
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (index: number, targetProperty: "front" | "back") => {
    if (!draggedItem) return;

    const sourceIndex = draggedItem.index;
    const sourceProperty = draggedItem.property;

    // Don't do anything if dropping on itself
    if (sourceIndex === index && sourceProperty === targetProperty) {
      setDraggedItem(null);
      return;
    }

    const updated = [...scanResults];

    // Helper to get rotation key
    const getRotKey = (p: "front" | "back") => p === "front" ? "frontRotation" : "backRotation";

    if (sourceIndex === index) {
      // SWAP WITHIN SAME CARD
      const item = { ...updated[index] };

      const sourceVal = item[sourceProperty];
      const targetVal = item[targetProperty];

      const sourceRot = item[getRotKey(sourceProperty)];
      const targetRot = item[getRotKey(targetProperty)];

      // Update Source Property with Target Value
      if (sourceProperty === "front") {
        item.front = targetVal || "";
      } else {
        item.back = targetVal;
      }

      // Update Target Property with Source Value
      if (targetProperty === "front") {
        item.front = sourceVal || "";
      } else {
        item.back = sourceVal;
      }

      // Swap Rotations
      // Since frontRotation and backRotation are both number | undefined, dynamic access is safe enough here, 
      // but let's be explicit to avoid any confusion or future lints.
      if (sourceProperty === "front") item.frontRotation = targetRot;
      else item.backRotation = targetRot;

      if (targetProperty === "front") item.frontRotation = sourceRot;
      else item.backRotation = sourceRot;

      updated[index] = item;
    } else {
      // SWAP BETWEEN CARDS
      const sourceItem = { ...updated[sourceIndex] };
      const targetItem = { ...updated[index] };

      const sourceVal = sourceItem[sourceProperty];
      const sourceRot = sourceItem[getRotKey(sourceProperty)];

      const targetVal = targetItem[targetProperty];
      const targetRot = targetItem[getRotKey(targetProperty)];

      // Apply Swap
      // 1. Move Target -> Source
      if (sourceProperty === "front") {
        sourceItem.front = targetVal || "";
        sourceItem.frontRotation = targetRot;
      } else {
        sourceItem.back = targetVal;
        sourceItem.backRotation = targetRot;
      }

      // 2. Move Source -> Target
      if (targetProperty === "front") {
        targetItem.front = sourceVal || "";
        targetItem.frontRotation = sourceRot;
      } else {
        targetItem.back = sourceVal;
        targetItem.backRotation = sourceRot;
      }

      updated[sourceIndex] = sourceItem;
      updated[index] = targetItem;
    }

    setScanResults(updated);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const renderInfoPanel = (pair: ScanPair, index: number) => {
    // Reusable Manual Search Form
    const ManualSearchForm = () => (
      <div className="pt-4 mt-auto">
        <div className="w-full h-px bg-slate-200 dark:bg-slate-700 mb-4" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
          Cari Manual / Ubah Data
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const npsn = formData.get("npsn") as string;
            // Always allow re-search
            if (npsn) handleManualCheck(index, npsn);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            name="npsn"
            placeholder="Ketik NPSN..."
            className="flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:font-normal text-slate-700 dark:text-slate-200"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-black transition-colors"
          >
            CARI
          </button>
        </form>
      </div>
    );

    return (
      <div className="flex flex-col h-full">
        {pair.matchStatus === "loading" && (
          <div className="p-4 rounded-xl border border-blue-100 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm animate-pulse mb-4">
            Menghubungkan ke database...
          </div>
        )}

        {/* MATCHED STATE */}
        {pair.matchStatus === "matched" && pair.selectedApproval && (
          <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm space-y-4 flex flex-col min-h-[160px]">
            {/* School Name - Primary Info */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nama Sekolah</p>
              <p className="text-xl md:text-2xl font-black text-slate-800 dark:text-white leading-tight">
                {pair.selectedApproval.nama_sekolah || "-"}
              </p>
            </div>

            {/* NPSN - Secondary Info */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">NPSN</p>
              <p className="font-mono text-lg font-bold text-slate-600 dark:text-slate-300">
                {pair.selectedApproval.npsn}
              </p>
            </div>

            {/* SN BAPP - Tertiary Info */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">SN Dokumen</p>
              <p className="font-mono text-lg font-bold text-slate-600 dark:text-slate-300">
                {pair.selectedApproval.sn_bapp}
              </p>
            </div>

            {/* Status Pill */}
            <div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-black uppercase tracking-wide ${pair.selectedApproval.hasil_cek === "sesuai"
                ? "bg-green-100 text-green-700 border border-green-200"
                : "bg-red-100 text-red-700 border border-red-200"
                }`}>
                {pair.selectedApproval.hasil_cek === "sesuai" ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    SESUAI
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    TIDAK SESUAI
                  </>
                )}
              </span>
            </div>

            {/* Manual Search in Matched State */}
            <ManualSearchForm />
          </div>
        )}

        {/* AMBIGUOUS / DUPLICATE STATE */}
        {pair.matchStatus === "ambiguous" && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 rounded-2xl p-4 flex flex-col gap-4">
            <div>
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-3 flex items-center gap-2">
                ⚠️ Pilih salah satu ({pair.approvalData?.length} data):
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {pair.approvalData?.map((choice, cIdx) => (
                  <button
                    key={cIdx}
                    onClick={() => handleSelectApproval(index, choice)}
                    className="w-full text-left p-3 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded-xl hover:border-amber-500 transition-all flex justify-between items-center group"
                  >
                    <div className="text-xs">
                      <p className="font-black text-slate-700 dark:text-slate-200">{choice.npsn}</p>
                      <p className="font-mono text-slate-500 truncate w-32">{choice.sn_bapp}</p>
                    </div>
                    <div className="bg-amber-500 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Search in Ambiguous State */}
            <ManualSearchForm />
          </div>
        )}

        {/* NOT MATCHED / NOT FOUND STATE */}
        {pair.matchStatus === "not-matched" && (
          <div className="bg-red-50 dark:bg-red-900/10 border-2 border-red-100 dark:border-red-900/30 p-5 rounded-2xl space-y-3 flex flex-col">
            <div>
              <p className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-2 mb-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Data BAPP Tidak Ditemukan
              </p>
              <p className="text-[10px] text-red-500/80 leading-tight">
                Sistem tidak menemukan kecocokan otomatis. Silakan cari manual menggunakan NPSN.
              </p>
            </div>

            {/* Manual Search (Already existing, but using the Reusable Component for consistency if desired, or keeping custom one?) 
                The previous one had slightly specific styling (red borders). 
                I'll stick to the reusable one to keep it uniform or adapt the reusable one?
                Let's just use the reusable one, it looks clean enough.
                Wait, the previous one was Red themed for Not Found.
                Let's include the specific red input in the ManualSearchForm if we wanted context, 
                but a generic Blue/Neutral search bar is fine too.
                Actually, let's just use ManualSearchForm to ensure it's "bisa dicari by npsn manual lagi".
            */}
            <ManualSearchForm />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center p-4">
      {/* Main Card Container with Dynamic Width */}
      <div
        className={`transition-all duration-500 ease-in-out ${viewMode === "start" ? "w-full max-w-xl" : "w-full max-w-[95%]"
          } bg-white dark:bg-slate-900 rounded-xl shadow-lg overflow-hidden border border-gray-100 dark:border-slate-800`}
      >
        {/* Header */}
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
            {viewMode === "results" && (
              <button
                onClick={handleBackToStart}
                className="p-2 -ml-2 rounded-full hover:bg-slate-700 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
                  />
                </svg>
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-wide">
              Scanner Dokumentasi Sekolah
            </h1>
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
            aria-label="Toggle Theme"
          >
            {theme === "light" ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* VIEW MODE: START */}
          {viewMode === "start" && (
            <div className="space-y-6 animate-in fade-in zoom-in duration-300">
              <div className="text-center mb-8">
                <div className="inline-block p-4 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-12 h-12 text-blue-600 dark:text-blue-400"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
                  Siap untuk Memindai?
                </h2>
                <p className="text-gray-500 dark:text-gray-400">
                  Pastikan scanner menyala dan dokumen sudah siap.
                </p>
              </div>

              {/* Profile Configuration */}
              <div className="bg-blue-50 dark:bg-slate-900/50 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                <label
                  htmlFor="profileName"
                  className="block text-sm font-medium text-black dark:text-gray-200 mb-2"
                >
                  Pilih Profil NAPS2
                </label>
                {profiles.length > 0 ? (
                  <select
                    id="profileName"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full px-4 py-2 border border-blue-200 dark:border-blue-800/50 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800"
                  >
                    {profiles.map((p, idx) => (
                      <option key={idx} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="profileName"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full px-4 py-2 border border-blue-200 dark:border-blue-800/50 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800"
                      placeholder="Nama Profile (Manual)"
                    />
                    <span className="text-xs text-gray-400 self-center whitespace-nowrap">
                      (Gagal load profiles)
                    </span>
                  </div>
                )}
              </div>

              {/* Status Indicator */}
              {status.msg && (
                <div
                  className={`p-4 rounded-lg text-sm font-medium border ${status.type === "error"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : status.type === "success"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}
                >
                  {status.msg}
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={handleScan}
                disabled={loading}
                className={`w-full py-4 px-6 rounded-lg font-bold text-white shadow-md transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 ${loading
                  ? "bg-gray-400 cursor-not-allowed opacity-75"
                  : "bg-blue-600 hover:bg-blue-700"
                  }`}
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>Sedang Scanning...</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      ></path>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      ></path>
                    </svg>
                    <span>MULAI SCAN DOKUMEN</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* VIEW MODE: RESULTS */}
          {viewMode === "results" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Status Bar (Sticky/Top) */}
              <div className="flex justify-between items-center bg-gray-50 dark:bg-slate-800/50 p-4 rounded-lg border border-gray-200 dark:border-slate-700">
                <div>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-white">
                    Hasil Scan
                  </h2>
                  <p className="text-sm text-gray-500">
                    {scanResults.length} Dokumen ditemukan
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleClearAll}
                    className="px-4 py-2 bg-red-100/50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-bold border border-red-200 transition-colors flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Hapus Semua
                  </button>
                  {status.type === "processing" && (
                    <span className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-200 animate-pulse">
                      <svg
                        className="animate-spin h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      {status.msg}
                    </span>
                  )}
                  <div className="flex gap-2">
                    <div
                      className="px-3 py-1.5 rounded-lg bg-green-100 text-green-700 border border-green-200 text-xs font-bold flex items-center gap-1"
                      title="Data Sesuai BAPP"
                    >
                      <span>✅</span>{" "}
                      {
                        scanResults.filter(
                          (r) =>
                            r.matchStatus === "matched" &&
                            r.selectedApproval?.hasil_cek === "sesuai",
                        ).length
                      }{" "}
                      Sesuai
                    </div>
                    <div
                      className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 border border-red-200 text-xs font-bold flex items-center gap-1"
                      title="Data Tidak Sesuai / Tidak Ditemukan"
                    >
                      <span>❌</span>{" "}
                      {
                        scanResults.filter(
                          (r) =>
                            (r.matchStatus === "matched" &&
                              r.selectedApproval?.hasil_cek !== "sesuai") ||
                            r.matchStatus === "not-matched",
                        ).length
                      }{" "}
                      Tidak
                    </div>
                    <div
                      className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold flex items-center gap-1"
                      title="Butuh Verifikasi Manual"
                    >
                      <span>⚠️</span>{" "}
                      {
                        scanResults.filter((r) => r.matchStatus === "ambiguous")
                          .length
                      }{" "}
                      Duplikat
                    </div>
                  </div>
                </div>
              </div>

              {/* Results List */}
              {/* Results List */}
              <div className="space-y-8">
                {scanResults.map((pair, index) => (
                  <div
                    key={index}
                    className={`relative p-6 rounded-2xl border-2 transition-all duration-500 shadow-sm ${pair.isSaved
                      ? "bg-indigo-50/30 border-indigo-200 dark:bg-indigo-950/10 dark:border-indigo-800 ring-4 ring-indigo-500/10"
                      : pair.matchStatus === "matched"
                        ? pair.selectedApproval?.hasil_cek === "sesuai"
                          ? "bg-green-50/30 border-green-200 dark:bg-green-950/10 dark:border-green-800"
                          : "bg-red-50/30 border-red-200 dark:bg-red-950/10 dark:border-red-800"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                      }`}
                  >
                    {/* Badge Sudah Simpan */}
                    {pair.isSaved && (
                      <div className="absolute -top-3 -right-3 bg-indigo-600 text-white px-4 py-1 rounded-full text-xs font-black shadow-lg animate-bounce uppercase tracking-widest z-10">
                        Tersimpan
                      </div>
                    )}

                    {/* --- HEADER SECTION --- */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black text-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={pair.docName || `Dokumen #${index + 1}`}
                            onChange={(e) => handleNameChange(index, e.target.value)}
                            className="block w-full font-black text-xl text-slate-800 dark:text-slate-100 bg-transparent border-b-2 border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none transition-all py-1"
                          />
                          <div className="flex gap-3 items-center mt-1">
                            {pair.ocrStatus === "success" && (
                              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-md">
                                OCR Terdeteksi
                              </span>
                            )}
                            {pair.ocrStatus === "processing" && (
                              <span className="text-[10px] font-bold uppercase text-blue-500 animate-pulse bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded-md">
                                Menganalisa...
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Toolbar */}
                      <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-slate-800/50 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
                        <button
                          onClick={() => handleDelete(index)}
                          className="p-2 rounded-xl hover:bg-red-500 hover:text-white text-red-500 transition-all"
                          title="Hapus"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleRetryOcr(index)}
                          disabled={pair.ocrStatus === "processing"}
                          className="p-2 rounded-xl hover:bg-amber-500 hover:text-white text-amber-500 transition-all disabled:opacity-30"
                        >
                          <svg className={`w-5 h-5 ${pair.ocrStatus === "processing" ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
                        <button
                          onClick={() => handleSave(index)}
                          disabled={pair.isSaved || pair.matchStatus !== "matched" || pair.isSaving}
                          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-black transition-all active:scale-95 shadow-md ${pair.isSaved
                            ? "bg-green-500 text-white cursor-default"
                            : pair.isSaving
                              ? "bg-indigo-400 text-white cursor-wait"
                              : pair.matchStatus === "matched"
                                ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-none"
                                : "bg-slate-300 text-slate-500 cursor-not-allowed"
                            }`}
                        >
                          {pair.isSaving ? (
                            <>
                              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Menyimpan...
                            </>
                          ) : pair.isSaved ? (
                            "Tersimpan"
                          ) : (
                            "Simpan Data"
                          )}
                        </button>
                      </div>
                    </div>

                    {/* --- DATA INFO BOX --- */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Left: Metadata */}
                      <div className="lg:col-span-4 space-y-4">
                        {renderInfoPanel(pair, index)}
                      </div>

                      {/* Right: Image Preview Grid */}
                      <div className="lg:col-span-8 grid grid-cols-2 gap-4 relative">
                        {[
                          { label: "Depan", property: "back" as const, src: pair.back, rot: pair.backRotation || 0 },
                          { label: "Belakang", property: "front" as const, src: pair.front, rot: pair.frontRotation || 0 },
                        ].map((img, i) => (
                          <div
                            key={i}
                            className={`group relative transition-all duration-200 ${draggedItem?.index === index && draggedItem?.property === img.property
                              ? "opacity-40 scale-95"
                              : "opacity-100"
                              }`}
                            draggable
                            onDragStart={() => handleDragStart(index, img.property)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(index, img.property)}
                            onDragEnd={handleDragEnd}
                          >
                            <div className="absolute top-2 left-2 z-10 pointer-events-none flex gap-2">
                              <span className="bg-black/50 backdrop-blur-md text-white text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-widest">
                                {img.label}
                              </span>
                            </div>

                            {/* Rotate Button */}
                            {img.src && (
                              <button
                                onClick={() => handleRotate(index, img.property)}
                                disabled={pair.isRotating}
                                className="absolute top-2 right-2 z-20 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full backdrop-blur-md transition-colors opacity-0 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-100"
                                title="Putar Gambar 90° (Permanen)"
                              >
                                {pair.isRotating ? (
                                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                )}
                              </button>
                            )}

                            <div className="aspect-[3/4] rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 group-hover:border-indigo-400 transition-all shadow-sm">
                              {img.src ? (
                                <img
                                  src={img.src}
                                  alt={img.label}
                                  onClick={() => setPreviewImage(img.src!)}
                                  className="w-full h-full object-cover cursor-grab active:cursor-grabbing transition-transform duration-300 group-hover:scale-105"
                                  style={{ transform: `rotate(${img.rot}deg)` }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs flex-col gap-2">
                                  <svg className="w-8 h-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  <span>Kosong (Drop Here)</span>
                                </div>
                              )}

                              {/* Overlay saat hover */}
                              <div className="absolute inset-0 bg-indigo-900/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                            </div>
                          </div>
                        ))}

                        {/* HIGHLIGHT KODE (Muncul melayang setelah simpan) */}
                        {pair.isSaved && pair.selectedApproval?.kode && (
                          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                            <div className="bg-indigo-600 text-white p-6 rounded-3xl shadow-[0_20px_50px_rgba(79,70,229,0.4)] border-4 border-white dark:border-slate-900 transform -rotate-3 animate-in zoom-in duration-500 flex flex-col items-center">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-80">Kode Dokumen</span>
                              <span className="text-5xl font-black tracking-tighter drop-shadow-md">
                                {pair.selectedApproval.kode}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      {
        previewImage && (
          <div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="relative w-full h-full flex flex-col items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Floating Info Panel (Left) using Render Function */}
              {(() => {
                const currentIndex = scanResults.findIndex(
                  (p) => p.front === previewImage || p.back === previewImage
                );
                const currentPair = scanResults[currentIndex];

                if (currentPair) {
                  return (
                    <div className="absolute top-1/2 -translate-y-1/2 left-4 z-50 w-80 max-h-[80vh] overflow-y-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-4 animate-in slide-in-from-left-4 fade-in duration-300">
                      {renderInfoPanel(currentPair, currentIndex)}
                    </div>
                  );
                }
                return null;
              })()}

              {/* Close Button Top Right */}
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-all backdrop-blur-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <TransformWrapper
                initialScale={1}
                minScale={0.5}
                maxScale={4}
                centerOnInit
              >
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    {/* Toolbar Controls */}
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-black/50 backdrop-blur-md border border-white/10 px-6 py-3 rounded-full shadow-2xl">
                      <button
                        onClick={() => zoomOut()}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95"
                        title="Zoom Out"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                        </svg>
                      </button>
                      <button
                        onClick={() => resetTransform()}
                        className="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-indigo-500/30"
                        title="Reset Zoom"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => zoomIn()}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95"
                        title="Zoom In"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>

                    {/* Image Viewport */}
                    <TransformComponent
                      wrapperClass="!w-full !h-full flex items-center justify-center"
                      wrapperStyle={{ width: "100%", height: "100%" }}
                      contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <img
                        src={previewImage}
                        alt="Preview"
                        className="max-h-[85vh] max-w-[90vw] w-auto h-auto object-contain rounded-lg shadow-2xl"
                      />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        )
      }
    </div >
  );
}
