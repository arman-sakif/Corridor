'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

/**
 * A link the owner sends however they already talk to their driver.
 *
 * Not an emailed invitation, because email currently reaches one address:
 * Corridor sends through Resend's sandbox sender until a domain is verified,
 * so an invite email would arrive nowhere. And these operators run their
 * businesses on phone, text and WhatsApp anyway — handing them something to
 * paste is closer to how they already work than an email would have been.
 */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        // Selecting the whole thing on focus makes a manual copy easy when the
        // clipboard is unavailable — an insecure origin, or a browser that
        // refuses the permission.
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg bg-ink-50 px-2 py-1 font-mono text-xs text-ink-700 ring-1 ring-ink-200"
      />
      <Button
        type="button"
        tone="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard refused. The field beside this is still selectable,
            // so say nothing and let them copy it by hand.
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
