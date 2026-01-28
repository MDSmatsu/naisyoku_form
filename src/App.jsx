import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { v4 as uuidv4 } from "uuid";
import { fetchWorkers, fetchWorks, addRecord } from "./api";

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [workers, setWorkers] = useState([]);
  const [works, setWorks] = useState([]);
  const [error, setError] = useState("");

  // form state
  const [recordId, setRecordId] = useState(uuidv4());
  const [workerCode, setWorkerCode] = useState("");
  const [jobCode, setJobCode] = useState("");
  const [product, setProduct] = useState("");
  const [process, setProcess] = useState("");
  const [partNo, setPartNo] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
  const [qty, setQty] = useState("");

  const [unitPrice, setUnitPrice] = useState(0);
  const [amount, setAmount] = useState(0);

  // ★ 送信中フラグ（②③）
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [toast, setToast] = useState(null);
  // toast = { message: string }

  // QR
  const [qrOpen, setQrOpen] = useState(false);
  const qrRegionId = "qr-reader";
  const qrRef = useRef(null);
  const qrRunningRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [w1, w2] = await Promise.all([fetchWorkers(), fetchWorks()]);
        setWorkers(w1);
        setWorks(w2);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const productOptions = useMemo(() => uniqSorted(works.map((w) => w.product)), [works]);
  const processOptions = useMemo(() => {
    if (!product) return uniqSorted(works.map((w) => w.process));
    return uniqSorted(works.filter((w) => w.product === product).map((w) => w.process));
  }, [works, product]);

  const partOptions = useMemo(() => {
    const filtered = works.filter((w) => {
      if (product && w.product !== product) return false;
      if (process && w.process !== process) return false;
      return true;
    });
    return uniqSorted(filtered.map((w) => w.partNo || "")); // 空欄あり
  }, [works, product, process]);

  // jobCode手入力 or QR入力 => workMasterから自動入力
  useEffect(() => {
    if (!jobCode) return;

    const hit = works.find((w) => w.jobCode === jobCode);
    if (!hit) {
      setError("内職コードが作業マスタに見つかりません。コードを確認してください。");
      setUnitPrice(0);
      return;
    }
    setError("");
    setProduct(hit.product);
    setProcess(hit.process);
    setPartNo(hit.partNo || "");
    setUnitPrice(Number(hit.unitPrice || 0));
  }, [jobCode, works]);

  // 商品/工程/品番（任意）から jobCode を自動検索
  useEffect(() => {
    // jobCodeが入ってるなら「コード優先」：勝手に上書きしない
    if (jobCode) return;
    if (!product || !process) return;

    const candidates = works.filter((w) => w.product === product && w.process === process);
    if (candidates.length === 0) return;

    // 品番は空欄可：選択が空なら「品番空のマスタ」優先、なければ最初
    let hit = null;

    if (partNo) {
      hit = candidates.find((w) => (w.partNo || "") === partNo) || null;
    } else {
      hit = candidates.find((w) => !w.partNo) || candidates[0];
    }

    if (!hit) return;
    setJobCode(hit.jobCode);
    setUnitPrice(Number(hit.unitPrice || 0));
  }, [product, process, partNo, jobCode, works]);

  // 金額計算
  useEffect(() => {
    const q = Number(qty);
    if (!Number.isFinite(q)) {
      setAmount(0);
      return;
    }
    setAmount(round2(unitPrice * q));
  }, [unitPrice, qty]);

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function showToast(message, duration = 3000) {
    setToast({ message });
    setTimeout(() => {
      setToast(null);
    }, duration);
  }

  function formatJstYYYYMMDDHHMMSS(date = new Date()) {
    // JSTにしたいので Intl で Asia/Tokyo を指定してから分解
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  }

  function resetForNext() {
    setRecordId(uuidv4());
    setJobCode("");
    setProduct("");
    setProcess("");
    setPartNo("");
    setQty("");
    setUnitPrice(0);
    setAmount(0);
    // workerCode / workDate は保持（連続入力が速い）
  }

  async function onSubmit(e) {
    e.preventDefault();

    // ★② 二重送信ガード
    if (isSubmitting) return;

    setError("");

    const q = Number(qty);
    if (!recordId) return setError("実績IDが空です。");
    if (!workerCode) return setError("内職者コードは必須です。");
    if (!jobCode) return setError("内職コードは必須です（QR or 手入力 or 商品選択で自動入力して）。");
    if (!product) return setError("商品は必須です。");
    if (!process) return setError("工程は必須です。");
    if (!workDate) return setError("作業日は必須です。");
    if (!Number.isFinite(q)) return setError("数量が数字ではありません。");
    if (q <= 0) return setError("数量は0より大きくしてください。");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setError("単価が読み取れません（作業マスタ確認）。");

    const payload = {
      実績ID: recordId,
      内職者コード: workerCode,
      内職コード: jobCode,
      商品: product,
      工程: process,
      作業日: workDate,
      数量: q,
      単価: unitPrice,
      金額: round2(unitPrice * q),
    };

    // ★② 送信開始
    setIsSubmitting(true);
    try {
      await addRecord(payload);

      showToast(`登録しました。\n${workDate} / ${product} / ${process} / 数量: ${q}`);

      resetForNext();
    } catch (e2) {
      setError(String(e2.message || e2));
    } finally {
      // ★② 必ず解除
      setIsSubmitting(false);
    }
  }

  // QR start/stop
  useEffect(() => {
    if (!qrOpen) return;

    let qrcode = null;
    const start = async () => {
      try {
        qrcode = new Html5Qrcode(qrRegionId);
        qrRef.current = qrcode;

        qrRunningRef.current = true;
        await qrcode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            // ここで内職コードのみがQRに入ってる前提
            setJobCode(decodedText.trim());
            setQrOpen(false);
          },
          () => {}
        );
      } catch (e) {
        setError("QR起動に失敗。カメラ権限/HTTPS/ブラウザ対応を確認して。 " + String(e));
        setQrOpen(false);
      }
    };

    start();

    return () => {
      (async () => {
        try {
          if (qrcode && qrRunningRef.current) {
            qrRunningRef.current = false;
            await qrcode.stop();
            await qrcode.clear();
          }
        } catch {
          // ignore
        }
      })();
    };
  }, [qrOpen]);

  if (loading) {
    return <div style={styles.page}>読み込み中…☕</div>;
  }

  const workerLabel = (c) => {
    const w = workers.find((x) => x.workerCode === c);
    return w ? `${w.workerCode} ${w.workerName}` : c;
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>内職実績 登録</h1>

      {error && <div style={styles.error}>{error}</div>}

      <form onSubmit={onSubmit} style={styles.card}>
        <div style={styles.grid}>
          <Field label="実績ID（必須）">
            <input value={recordId} readOnly style={styles.inputReadOnly} />
          </Field>

          <Field label="内職者コード（必須）">
            <select value={workerCode} onChange={(e) => setWorkerCode(e.target.value)} style={styles.select}>
              <option value="">選択</option>
              {workers.map((w) => (
                <option key={w.workerCode} value={w.workerCode}>
                  {w.workerCode} {w.workerName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="内職コード（必須 / QR可）">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={jobCode}
                onChange={(e) => setJobCode(e.target.value.trim())}
                placeholder="手入力 or QR"
                style={styles.input}
              />
              <button type="button" onClick={() => setQrOpen(true)} style={styles.btn} disabled={isSubmitting}>
                QR
              </button>
              <button
                type="button"
                onClick={() => setJobCode("")}
                style={styles.btnGhost}
                title="コード入力を消して、商品/工程ルートに戻す"
                disabled={isSubmitting}
              >
                クリア
              </button>
            </div>
          </Field>

          <Field label="商品（必須）">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              style={styles.select}
              disabled={!!jobCode || isSubmitting}
            >
              <option value="">選択</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {!!jobCode && <Hint>内職コード入力中は自動反映（手で変えると事故る）</Hint>}
          </Field>

          <Field label="工程（必須）">
            <select
              value={process}
              onChange={(e) => setProcess(e.target.value)}
              style={styles.select}
              disabled={!!jobCode || isSubmitting}
            >
              <option value="">選択</option>
              {processOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="作業日（必須）">
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              style={styles.input}
              disabled={isSubmitting}
            />
          </Field>

          <Field label="数量（必須 / 小数OK）">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              placeholder="例: 12 / 0.5"
              style={styles.input}
              disabled={isSubmitting}
            />
          </Field>

          <Field label="単価（自動 / 編集不可）">
  <input
    value={unitPrice}
    readOnly
    style={styles.inputReadOnly}
  />
</Field>

          <Field label="金額（自動）">
  <input
    value={amount}
    readOnly
    style={styles.inputReadOnly}
  />
</Field>


          <Field label="登録日時（必須 / 編集不可）">
            <input value={formatJstYYYYMMDDHHMMSS()} readOnly style={styles.inputReadOnly} />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={resetForNext} style={styles.btnGhost} disabled={isSubmitting}>
            次の入力へ（クリア）
          </button>

          {/* ★③ 送信中は押せない + 文言変更 */}
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.btnPrimary,
              opacity: isSubmitting ? 0.6 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "送信中..." : "登録する"}
          </button>
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          現在選択: <b>{workerCode ? workerLabel(workerCode) : "未選択"}</b>
        </div>
      </form>

      {qrOpen && (
        <div style={styles.modalBg} onClick={() => setQrOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <b>QRで内職コード読み取り</b>
              <button onClick={() => setQrOpen(false)} style={styles.btnGhost} disabled={isSubmitting}>
                閉じる
              </button>
            </div>
            <div id={qrRegionId} style={{ width: 320, maxWidth: "100%" }} />
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>※HTTPSじゃないとカメラ動かないことがあります。</div>
          </div>
        </div>
      )}

      {toast && (
        <div style={styles.toast}>
          {toast.message.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <div style={styles.label}>{label}</div>
      {children}
    </div>
  );
}
function Hint({ children }) {
  return <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>{children}</div>;
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", padding: 18, maxWidth: 980, margin: "0 auto" },
  h1: { margin: "4px 0 14px", fontSize: 22 },
  error: { background: "#ffe9e9", color: "#8a1f1f", padding: 10, borderRadius: 10, marginBottom: 12 },
  card: {
    background: "#fff",
    border: "1px solid #eee",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 6px 24px rgba(0,0,0,0.06)",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, color: "#444" },
  input: { padding: "10px 12px", border: "1px solid #ddd", borderRadius: 12, outline: "none" },
  inputReadOnly: { padding: "10px 12px", border: "1px solid #eee", borderRadius: 12, background: "#fafafa" },
  select: { padding: "10px 12px", border: "1px solid #ddd", borderRadius: 12, background: "#fff" },
  btn: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", background: "#fff", cursor: "pointer" },
  btnGhost: { padding: "10px 12px", borderRadius: 12, border: "1px solid #eee", background: "#fafafa", cursor: "pointer" },
  btnPrimary: { padding: "10px 14px", borderRadius: 12, border: "1px solid #111", background: "#111", color: "#fff" },
  modalBg: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modal: { background: "#fff", borderRadius: 16, padding: 14, width: 420, maxWidth: "100%" },
  toast: {
    position: "fixed",
    right: 20,
    bottom: 20,
    background: "#111",
    color: "#fff",
    padding: "14px 18px",
    borderRadius: 14,
    fontSize: 14,
    lineHeight: 1.5,
    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
    zIndex: 9999,
    whiteSpace: "pre-line",
  },
};
