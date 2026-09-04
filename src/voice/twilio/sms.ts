import { TwilioClient } from "./client.js";

export interface SendSmsOptions {
  to: string;
  body: string;
  /**
   * Optional Messaging Service SID. If set, Twilio picks the best sender
   * automatically (recommended for international + sticky-sender behavior).
   */
  messagingServiceSid?: string;
  /** Optional URL Twilio hits when delivery status changes. */
  statusCallback?: string;
  /** Optional media URL for MMS (image/PDF/etc). */
  mediaUrl?: string;
}

export interface MessageResource {
  sid: string;
  status: string;
  to: string;
  from?: string;
  body: string;
  num_segments: string;
  price?: string | null;
  price_unit?: string | null;
  date_created: string;
  uri: string;
}

export async function sendSms(
  client: TwilioClient,
  opts: SendSmsOptions,
): Promise<MessageResource> {
  const body: Record<string, string> = {
    To: opts.to,
    Body: opts.body,
  };
  if (opts.messagingServiceSid) {
    body["MessagingServiceSid"] = opts.messagingServiceSid;
  } else {
    body["From"] = client.fromNumber;
  }
  if (opts.statusCallback) {
    body["StatusCallback"] = opts.statusCallback;
  }
  if (opts.mediaUrl) {
    body["MediaUrl"] = opts.mediaUrl;
  }
  return client.post<MessageResource>("/Messages.json", body);
}
