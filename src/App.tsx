"use client";

import { useState, useEffect } from "react";
import Tesseract from "tesseract.js";

// --- Interface Data ---
interface ApprovalData {
  hasil_cek: string;
  npsn: string;
  sn_bapp: string;
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
  selectedApproval?: ApprovalData; // Stores the user-selected or auto-selected match
}

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
        const res = await fetch(`${import.meta.env.VITE_API_URL}/profiles`);
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

  const handleScan = async () => {
    setLoading(true);
    setStatus({ type: "idle", msg: "⏳ Menghubungkan ke Scanner..." });
    setScanResults([]);

    try {
      const isMock = import.meta.env.VITE_USE_MOCK === "true";
      const apiUrl = import.meta.env.VITE_API_URL;

      const endpoint = isMock
        ? `${apiUrl}`
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
      const match = text.match(/Nomor\s*[:]\s*([A-Z0-9]+)/i);
      const detectedName = match && match[1] ? match[1] : null;

      return { text, detectedName };
    } catch (err) {
      console.error("OCR Error:", err);
      return { text: "(Gagal reading)", detectedName: null };
    }
  };

  const checkApproval = async (
    noBapp: string,
  ): Promise<{
    status: ScanPair["matchStatus"];
    data: ApprovalData[];
    selected?: ApprovalData;
  }> => {
    if (!noBapp) return { status: "idle", data: [] };

    try {
      const res = await fetch(
        `${import.meta.env.VITE_APPROVAL_API_URL}/api/is-approved?no_bapp=${encodeURIComponent(noBapp)}`,
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

  const handleManualCheck = async (index: number) => {
    const item = scanResults[index];
    if (!item.docName) return;

    const updated = [...scanResults];
    updated[index].matchStatus = "loading";
    setScanResults(updated);

    const checkDetails = await checkApproval(item.docName);
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center p-4">
      {/* Main Card Container with Dynamic Width */}
      <div
        className={`transition-all duration-500 ease-in-out ${
          viewMode === "start" ? "w-full max-w-xl" : "w-full max-w-[95%]"
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
                  className={`p-4 rounded-lg text-sm font-medium border ${
                    status.type === "error"
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
                className={`w-full py-4 px-6 rounded-lg font-bold text-white shadow-md transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 ${
                  loading
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
              <div className="space-y-6">
                {scanResults.map((pair, index) => (
                  <div
                    key={index}
                    className={`p-5 rounded-2xl border-2 transition-all duration-300 shadow-sm mb-6 ${
                      pair.matchStatus === "matched"
                        ? pair.selectedApproval?.hasil_cek === "sesuai"
                          ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                          : "bg-red-50/50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                        : pair.matchStatus === "ambiguous"
                          ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    {/* --- HEADER SECTION --- */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-sm border border-slate-200 dark:border-slate-700">
                          {index + 1}
                        </div>
                        <div className="flex-1 group">
                          <input
                            type="text"
                            value={pair.docName || `Dokumen #${index + 1}`}
                            onChange={(e) =>
                              handleNameChange(index, e.target.value)
                            }
                            className="block w-full font-bold text-xl text-slate-800 dark:text-slate-100 bg-transparent border-b-2 border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-all py-1"
                            placeholder="Masukkan nama dokumen..."
                          />
                          <div className="flex gap-2 items-center mt-1">
                            {pair.ocrStatus === "success" && (
                              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />{" "}
                                OCR Terverifikasi
                              </span>
                            )}
                            {pair.ocrStatus === "processing" && (
                              <span className="text-[10px] font-bold uppercase text-blue-500 animate-pulse">
                                Memproses OCR...
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Toolbar */}
                      <div className="flex items-center self-end md:self-center gap-2 bg-white/50 dark:bg-slate-800/50 p-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-inner">
                        <button
                          onClick={() => handleRetryOcr(index)}
                          disabled={pair.ocrStatus === "processing"}
                          className="p-2.5 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 transition-colors disabled:opacity-30"
                          title="Scan Ulang"
                        >
                          <svg
                            className={`w-5 h-5 ${pair.ocrStatus === "processing" ? "animate-spin" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        </button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
                        <button className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-indigo-200 dark:shadow-none">
                          <span>Simpan</span>
                        </button>
                      </div>
                    </div>

                    {/* --- STATUS NOTIFICATION BAR --- */}
                    <div className="mb-5">
                      {pair.matchStatus === "loading" && (
                        <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm">
                          <div className="w-4 h-4 border-2 border-t-transparent border-blue-600 rounded-full animate-spin" />
                          Sinkronisasi dengan database BAPP...
                        </div>
                      )}

                      {pair.matchStatus === "matched" && (
                        <div
                          className={`flex items-center justify-between p-3 rounded-xl font-bold text-sm border ${
                            pair.selectedApproval?.hasil_cek === "sesuai"
                              ? "text-green-700 bg-green-100 border-green-200 dark:bg-green-900/30 dark:border-green-800"
                              : "text-red-700 bg-red-100 border-red-200 dark:bg-red-900/30 dark:border-red-800"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {pair.selectedApproval?.hasil_cek === "sesuai"
                              ? "✅ Status: Sesuai"
                              : "⚠️ Status: Tidak Sesuai"}
                          </div>
                          <span className="text-[10px] opacity-70 uppercase tracking-widest">
                            Verifikasi Selesai
                          </span>
                        </div>
                      )}

                      {pair.matchStatus === "not-matched" && (
                        <div className="flex flex-col sm:flex-row justify-between items-center bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800 gap-3">
                          <span className="text-sm font-semibold text-red-700 dark:text-red-400 italic font-mono">
                            Data BAPP Tidak Ditemukan
                          </span>
                          <button
                            onClick={() => handleManualCheck(index)}
                            className="w-full sm:w-auto px-4 py-1.5 bg-white dark:bg-slate-800 text-red-600 rounded-lg border border-red-200 shadow-sm hover:bg-red-50 transition-colors font-bold text-xs"
                          >
                            Cari Manual
                          </button>
                        </div>
                      )}
                    </div>

                    {/* --- AMBIGUOUS SELECTION --- */}
                    {pair.matchStatus === "ambiguous" && (
                      <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500 p-4 rounded-r-2xl">
                          <p className="text-sm font-bold text-amber-800 dark:text-amber-200 mb-3 flex items-center gap-2 uppercase tracking-tight">
                            <svg
                              className="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                            ⚠️ Ditemukan {pair.approvalData?.length || 0} data
                            duplikat. Pilih yang benar:
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {pair.approvalData?.map((choice, cIdx) => (
                              <button
                                key={cIdx}
                                onClick={() =>
                                  handleSelectApproval(index, choice)
                                }
                                className="w-full text-left p-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-amber-200 dark:border-amber-700 rounded-xl hover:border-amber-500 hover:shadow-md transition-all flex justify-between items-center group"
                              >
                                <div className="text-xs space-y-1">
                                  <div className="flex gap-2">
                                    <span className="text-slate-400 font-medium">
                                      NPSN:
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">
                                      {choice.npsn}
                                    </span>
                                  </div>
                                  <div className="flex gap-2 text-[10px]">
                                    <span className="text-slate-400 font-medium tracking-widest uppercase">
                                      Serial:
                                    </span>
                                    <span className="font-mono text-slate-600 dark:text-slate-300">
                                      {choice.sn_bapp}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${choice.hasil_cek === "sesuai" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                  >
                                    {choice.hasil_cek}
                                  </span>
                                  <div className="bg-amber-500 group-hover:bg-amber-600 text-white p-1.5 rounded-lg transition-colors">
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* --- IMAGE GRID --- */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[
                        { label: "Halaman Depan", src: pair.back, key: "back" },
                        {
                          label: "Halaman Belakang",
                          src: pair.front,
                          key: "front",
                        },
                      ].map((img) => (
                        <div key={img.key} className="space-y-3">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                              {img.label}
                            </span>
                            {!img.src && (
                              <span className="text-[10px] text-red-400 italic">
                                File Hilang
                              </span>
                            )}
                          </div>

                          <div className="relative group overflow-hidden rounded-2xl border-2 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 aspect-[4/3] flex items-center justify-center">
                            {img.src ? (
                              <>
                                <img
                                  src={img.src}
                                  alt={img.label}
                                  onClick={() => setPreviewImage(img.src!)}
                                  className="w-full h-full object-contain cursor-zoom-in group-hover:scale-105 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                  <div className="bg-white/20 backdrop-blur-md px-4 py-2 rounded-full border border-white/30 text-white text-xs font-bold flex items-center gap-2">
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                                      />
                                    </svg>
                                    Perbesar Gambar
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-slate-300 dark:text-slate-700">
                                <svg
                                  className="w-12 h-12"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={1}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                  />
                                </svg>
                                <span className="text-xs font-medium">
                                  Tidak ada gambar
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh]">
            <img
              src={previewImage}
              alt="Preview"
              className="max-h-[90vh] w-auto rounded-lg shadow-2xl hover:scale-105 transition-transform"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 p-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-8 h-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
