import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select";
import { Button } from "../components/ui/button";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
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
import { TransferHistory } from "../components/TransferHistory";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Theme } from "../components/Theme";
import { signOut } from "../components/WorkspaceAccess";
import { fixtureDecisions } from "../demo";
import { money } from "../types";

const profiles = [
  ["acc_student_101", "Учебный • 101"],
  ["acc_victim_409", "Личный • 409"],
  ["acc_drop_772", "Карта • 772"],
];
export function Mobile({ alias }: { alias?: string }) {
  const [account, setAccount] = useState(profiles[0][0]);
  const preview =
    new URLSearchParams(location.search).get("mode") === "fixtures";
  const [logoutError, setLogoutError] = useState(false);
  const [scenario, setScenario] = useState("normal");
  const [sequence, setSequence] = useState(0);
  return (
    <main className="phone-stage">
      <section className="phone">
        <header className="phone-nav">
          <ShieldCheck size={23} />
          <span className="bcc">
            bcc<span>.</span>kz
          </span>
          {alias && <TransferHistory />}
          <Theme />
        </header>
        <div className="profile">
          <span>
            {profiles.find(([id]) => id === alias)?.[1] || alias || "Демо-счёт"}
          </span>
          {alias ? (
            <Button
              onClick={() =>
                signOut("mobile").catch(() => setLogoutError(true))
              }
            >
              Выйти
            </Button>
          ) : (
            <NativeSelect
              aria-label="Demo account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {profiles.map(([id, label]) => (
                <NativeSelectOption key={id} value={id}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </div>
        {logoutError && <p role="alert">Не удалось выйти.</p>}
        {preview && (
          <Label className="profile">
            <span>Демо-сценарий</span>
            <NativeSelect
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              {Object.keys(fixtureDecisions).map((s) => (
                <NativeSelectOption key={s}>{s}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
        )}
        <Transfer
          fixture={preview ? fixtureDecisions[scenario] : undefined}
          key={(alias || account) + sequence + scenario}
          account={alias || account}
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
  const track = useRef<HTMLButtonElement>(null);
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
        <div className="bankcard consent-card">
          <div>
            <span>Демонстрационный счёт</span>
            <CreditCard size={22} />
          </div>
          <strong>
            1 250 000 <small>₸</small>
          </strong>
          <footer>
            SANA / PAY <b>•••• 4192</b>
          </footer>
        </div>
        <h1>Защита переводов</h1>
        <p>
          Датчики движения и ритм касаний помогают проверить перевод. Вводите
          только вымышленные реквизиты.
        </p>
        <Button
          className="primary"
          disabled={prompting}
          onClick={async () => {
            setPrompting(true);
            setPermission(fixture ? "allowed" : await requestSensorAccess());
          }}
        >
          Включить защиту SANA Shield <ArrowRight size={17} />
        </Button>
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
                <Button onClick={() => setLiveness("pass")}>Пройдена</Button>
                <Button onClick={() => setLiveness("fail")}>Отклонена</Button>
              </div>
            )}
          </div>
        )}
        {calibrationNote && <p>{calibrationNote}</p>}
        <div className="reference">
          Номер операции <b>{result.reference_code}</b>
        </div>
        <Button className="primary" onClick={reset}>
          Новый перевод <ArrowRight size={16} />
        </Button>
      </section>
    );
  const locked = busy || !!error;
  return (
    <div className="transfer">
      <div className="titleline">
        <h1>Перевод</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button
              size="sm"
              disabled={locked}
              variant="ghost"
              data-kinetiq-field="review"
            >
              Детали <ArrowUpRight />
            </Button>
          </DialogTrigger>
          <DialogContent
            className="dossier-dialog"
            aria-describedby={undefined}
          >
            <DialogTitle>Детали перевода</DialogTitle>
            <dl className="review-details">
              <dt>Сумма</dt>
              <dd>{money(Number(amount))} ₸</dd>
              <dt>Получатель</dt>
              <dd>{isNew ? "Новый" : "Знакомый"}</dd>
              <dt>Комиссия в демо</dt>
              <dd>0 ₸</dd>
            </dl>
            <p>Демонстрационная операция. Деньги не списываются.</p>
          </DialogContent>
        </Dialog>
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
          SANA / PAY <b>•••• 4192</b>
        </footer>
      </div>
      {permission === "limited" && (
        <p className="phone-note">Доступ к датчикам ограничен.</p>
      )}
      <Button
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
      </Button>
      <Button
        disabled={locked}
        className={"amount-field " + (field === "amount" ? "selected" : "")}
        onClick={() => setField("amount")}
        data-kinetiq-field="amount"
      >
        <small>Сумма перевода</small>
        <b>{money(Number(amount))} ₸</b>
      </Button>
      <div className="chips" data-kinetiq-field="preset">
        {[50000, 250000, 1000000].map((n) => (
          <Button
            disabled={locked}
            key={n}
            onClick={() => setAmount(String(n))}
          >
            {money(n)} ₸
          </Button>
        ))}
      </div>
      <Label className="checkline" data-kinetiq-field="recipient_type">
        <Checkbox
          disabled={locked}
          checked={isNew}
          onCheckedChange={(value) => setNew(value === true)}
        />{" "}
        Новый получатель
      </Label>
      {!fixture && (
        <Label className="checkline">
          <Checkbox
            disabled={locked}
            checked={calibrate}
            onCheckedChange={(value) => setCalibrate(value === true)}
          />{" "}
          Сохранить телеметрию для калибровки
        </Label>
      )}
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map(
          (v) =>
            v ? (
              <Button
                disabled={locked}
                key={v}
                data-kinetiq-field={field}
                data-key-group={v === "del" ? "backspace" : "digit"}
                onClick={() => key(v)}
                aria-label={v === "del" ? "Удалить" : v}
              >
                {v === "del" ? <Delete size={20} /> : v}
              </Button>
            ) : (
              <span key="empty" />
            ),
        )}
      </div>
      <Button
        type="button"
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
      </Button>
      {error && (
        <div role="alert" className="phone-error">
          {error}
          <Button onClick={() => void submit()}>Повторить отправку</Button>
        </div>
      )}
      <small className="footnote">
        <ShieldCheck size={13} /> SANA Shield · Симуляция
      </small>
    </div>
  );
}
