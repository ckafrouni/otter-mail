import { useState } from "react";
import {
  Dialog,
  Field,
  Input,
  Textarea,
  toast,
} from "@glaze/core/components";
import { useSendMessage } from "./hooks";

type ComposeDialogProps = {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: {
    to?: string;
    subject?: string;
    body?: string;
  };
};

export function ComposeDialog({
  accountId,
  open,
  onOpenChange,
  prefill,
}: ComposeDialogProps) {
  const [to, setTo] = useState(prefill?.to ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");

  const sendMessage = useSendMessage();

  const handleSend = async () => {
    console.log("[ComposeDialog:send]", { to, subject });
    await sendMessage.mutateAsync({
      accountId,
      to,
      cc: cc.trim() || undefined,
      bcc: bcc.trim() || undefined,
      subject,
      body,
    });
    toast.success("Message sent");
    onOpenChange(false);
    setTo(prefill?.to ?? "");
    setCc("");
    setBcc("");
    setShowCcBcc(false);
    setSubject(prefill?.subject ?? "");
    setBody(prefill?.body ?? "");
  };

  const canSend = to.trim().length > 0 && subject.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Message"
      confirmLabel="Send"
      confirmVariant="accent"
      confirmDisabled={!canSend || sendMessage.isPending}
      onConfirm={handleSend}
      size="large"
    >
      <div className="flex flex-col gap-3 p-1">
        <Field label="To" orientation="vertical">
          <div className="flex items-center gap-2">
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1"
            />
            {!showCcBcc ? (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="shrink-0 text-mini text-tertiary hover:text-secondary transition-colors"
              >
                Cc/Bcc
              </button>
            ) : null}
          </div>
        </Field>
        {showCcBcc ? (
          <>
            <Field label="Cc" orientation="vertical">
              <Input
                type="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
              />
            </Field>
            <Field label="Bcc" orientation="vertical">
              <Input
                type="email"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
              />
            </Field>
          </>
        ) : null}
        <Field label="Subject" orientation="vertical">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
        </Field>
        <Field label="Body" orientation="vertical">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={8}
          />
        </Field>
      </div>
    </Dialog>
  );
}
