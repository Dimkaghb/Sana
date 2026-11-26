import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronsRight,
  CreditCard,
  Delete,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import {
  requestSensorAccess,
  useKinetiq,
  type Decision,
  type SensorAccess,
} from "../sdk";
import { fixtureDecisions } from "../demo";
import { money } from "../types";

const profiles = [
  ["acc_student_101", "Student • 101"],
  ["acc_victim_409", "Personal • 409"],
  ["acc_drop_772", "Card • 772"],
];
export function Mobile() {
  const [account, setAccount] = useState(profiles[0][0]);
  const preview =
    new URLSearchParams(location.search).get("mode") === "fixtures";
  const [scenario, setScenario] = useState("normal");
  const [sequence, setSequence] = useState(0);
  return (
    <main className="phone-stage">
      <section className="phone">
        <header className="phone-nav">
          <a href="/dashboard" aria-label="Command center">
            <ChevronLeft />
          </a>
          <span className="bcc">
            bcc<span>.</span>kz
          </span>
          <ShieldCheck size={21} />
        </header>
        <div className="profile">
          <span>Demo profile</span>
          <select
            aria-label="Demo account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            {profiles.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {preview && (
          <label className="profile">
            <span>Fixture preview</span>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              {Object.keys(fixtureDecisions).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <Transfer
          fixture={preview ? fixtureDecisions[scenario] : undefined}
          key={account + sequence + scenario}
          account={account}
          reset={() => setSequence((n) => n + 1)}
        />
      </section>
    </main>
  );
}
function Transfer({
  account,
  reset,
  fixture,
}: {
  account: string;
  reset: () => void;
  fixture?: Decision;
}) {
  const [permission, setPermission] = useState<SensorAccess>();
  const [prompting, setPrompting] = useState(false);
  const [amount, setAmount] = useState("50000");
  const [recipient, setRecipient] = useState("");
  const [field, setField] = useState<"recipient" | "amount">("recipient");
  const [calibrate, setCalibrate] = useState(false);
  const [calibrationNote, setCalibrationNote] = useState("");
  const [isNew, setNew] = useState(true);
  const [liveness, setLiveness] = useState<"pass" | "fail">();
  const [result, setResult] = useState<Decision>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const dragged = useRef<number | undefined>(undefined);
  const sdk = useKinetiq(
    account,
    !!permission && !result && !fixture,
    () => {
      const element = track.current;
      if (!element || !canSubmit || !window.PointerEvent) return;
      // A browser-generated pointer event reaches the same collector as a physical tap.
      const rect = element.getBoundingClientRect();
      const init = {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 9001,
        pointerType: "mouse",
        width: 0,
        height: 0,
      };
      element.dispatchEvent(new PointerEvent("pointerdown", init));
      element.dispatchEvent(new PointerEvent("pointerup", init));
      void submit();
    },
    permission === "allowed",
  );
  const canSubmit =
    (!!fixture || !!sdk) &&
    !busy &&
    recipient.length >= 4 &&
    Number(amount) > 0;
  async function submit() {
    if (!canSubmit) return;
    if (fixture) {
      setResult(fixture);
      return;
    }
    if (!sdk) return;
    setBusy(true);
    setError("");
    try {
      const decision = await sdk.submit({
        amount_kzt: Number(amount),
        is_new_recipient: isNew,
      });
      if (calibrate) {
        try {
          await sdk.saveCalibrationWithConsent();
          setCalibrationNote("Запись калибровки сохранена.");
        } catch {
          setCalibrationNote("Не удалось сохранить запись калибровки.");
        }
      }
      setResult(decision);
    } catch {
      setError(
        "Не удалось получить решение. Повторите отправку этой операции.",
      );
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }
  function key(value: string) {
    const set = field === "amount" ? setAmount : setRecipient;
    set((old) =>
      value === "del"
        ? old.slice(0, -1)
        : (old + value).slice(0, field === "amount" ? 9 : 16),
    );
  }
  if (!permission)
    return (
      <section className="consent">
        <div className="security-art">
          <ShieldCheck strokeWidth={1.1} />
        </div>
        <p className="eyebrow">SANA SHIELD</p>
        <h1>
          Защита
          <br />
          переводов
        </h1>
        <p>
          Датчики движения и ритм касаний помогают проверить перевод. Вводите
          только вымышленные реквизиты.
        </p>
        <button
          className="primary"
          disabled={prompting}
          onClick={async () => {
            setPrompting(true);
            setPermission(fixture ? "allowed" : await requestSensorAccess());
          }}
        >
          Включить защиту SANA Shield <ArrowRight size={17} />
        </button>
        <small>Демонстрационный перевод · Деньги не списываются</small>
      </section>
    );
  if (result)
    return (
      <section className={"receipt " + result.ui_mode}>
        <div className="receipt-icon">
          {result.ui_mode === "SUCCESS" ? (
            <Check />
          ) : result.ui_mode === "MIRAGE_HOLD" ? (
            <LockKeyhole />
          ) : (
            <Fingerprint />
          )}
        </div>
        <p className="eyebrow">BCC · ПЕРЕВОД</p>
        <h1>{result.display_title}</h1>
        <strong>{money(Number(amount))} ₸</strong>
        <p>{result.display_subtitle}</p>
        {result.ui_mode === "STEP_UP_LIVENESS" && (
          <div className="liveness">
            <Fingerprint size={28} />
            <h3>Демо-проверка получателя</h3>
            {liveness ? (
              <p>
                {liveness === "pass"
                  ? "Демо-проверка пройдена"
                  : "Демо-проверка отклонена"}
              </p>
            ) : (
              <div>
                <button onClick={() => setLiveness("pass")}>Пройдена</button>
                <button onClick={() => setLiveness("fail")}>Отклонена</button>
              </div>
            )}
          </div>
        )}
        {calibrationNote && <p>{calibrationNote}</p>}
        <div className="reference">
          Номер операции <b>{result.reference_code}</b>
        </div>
        <button className="primary" onClick={reset}>
          Новый перевод <ArrowRight size={16} />
        </button>
      </section>
    );
  const locked = busy || !!error;
  return (
    <div className="transfer">
      <div className="titleline">
        <h1>Перевод</h1>
        <ArrowUpRight />
      </div>
      <div className="bankcard">
        <div>
          <span>Доступно на карте</span>
          <CreditCard size={21} />
        </div>
        <strong>
          1 250 000 <small>₸</small>
        </strong>
        <footer>
          BCC IRON <b>•••• 4192</b>
        </footer>
      </div>
      {permission === "limited" && (
        <p className="phone-note">Доступ к датчикам ограничен.</p>
      )}
      <button
        disabled={locked}
        className={"amount-field " + (field === "recipient" ? "selected" : "")}
        onClick={() => setField("recipient")}
        data-kinetiq-field="recipient"
      >
        <small>Карта или телефон получателя</small>
        <b>
          {recipient
            ? "•".repeat(Math.max(0, recipient.length - 4)) +
              recipient.slice(-4)
            : "Введите демо-номер"}
        </b>
      </button>
      <button
        disabled={locked}
        className={"amount-field " + (field === "amount" ? "selected" : "")}
        onClick={() => setField("amount")}
        data-kinetiq-field="amount"
      >
        <small>Сумма перевода</small>
        <b>{money(Number(amount))} ₸</b>
      </button>
      <div className="chips">
        {[50000, 250000, 1000000].map((n) => (
          <button
            disabled={locked}
            key={n}
            onClick={() => setAmount(String(n))}
          >
            {money(n)} ₸
          </button>
        ))}
      </div>
      <label className="checkline">
        <input
          disabled={locked}
          type="checkbox"
          checked={isNew}
          onChange={(e) => setNew(e.target.checked)}
        />{" "}
        Новый получатель
      </label>
      {!fixture && (
        <label className="checkline">
          <input
            disabled={locked}
            type="checkbox"
            checked={calibrate}
            onChange={(e) => setCalibrate(e.target.checked)}
          />{" "}
          Сохранить телеметрию для калибровки
        </label>
      )}
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map(
          (v) =>
            v ? (
              <button
                disabled={locked}
                key={v}
                data-kinetiq-field={field}
                data-key-group={v === "del" ? "backspace" : "digit"}
                onClick={() => key(v)}
                aria-label={v === "del" ? "Удалить" : v}
              >
                {v === "del" ? <Delete size={20} /> : v}
              </button>
            ) : (
              <span key="empty" />
            ),
        )}
      </div>
      <div
        ref={track}
        className={"slide " + (!canSubmit ? "disabled" : "")}
        role="button"
        tabIndex={canSubmit ? 0 : -1}
        aria-disabled={!canSubmit}
        aria-label="Подтвердить перевод"
        data-kinetiq-field="slider"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void submit();
          }
        }}
        onPointerDown={(e) => {
          if (
            canSubmit &&
            e.nativeEvent.isTrusted &&
            e.clientX <= e.currentTarget.getBoundingClientRect().left + 52
          ) {
            dragged.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (dragged.current === e.pointerId) {
            const r = e.currentTarget.getBoundingClientRect();
            setProgress(
              Math.max(
                0,
                Math.min(1, (e.clientX - r.left - 24) / (r.width - 48)),
              ),
            );
          }
        }}
        onPointerCancel={() => {
          dragged.current = undefined;
          setProgress(0);
        }}
        onPointerUp={(e) => {
          if (dragged.current !== e.pointerId) return;
          const r = e.currentTarget.getBoundingClientRect();
          dragged.current = undefined;
          setProgress(0);
          if (e.clientX >= r.right - 48) void submit();
        }}
      >
        <span>{busy ? "Обработка…" : "Потяните для перевода"}</span>
        <i
          style={{
            left:
              "calc(" + progress * 100 + "% - " + progress * 51 + "px + 4px)",
          }}
        >
          <ChevronsRight size={21} />
        </i>
      </div>
      {error && (
        <div role="alert" className="phone-error">
          {error}
          <button onClick={() => void submit()}>Повторить отправку</button>
        </div>
      )}
      <small className="footnote">
        <ShieldCheck size={13} /> SANA Shield · Симуляция
      </small>
    </div>
  );
}
