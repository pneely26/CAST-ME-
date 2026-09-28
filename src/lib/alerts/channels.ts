import type { AlertType } from "@prisma/client";

export interface AlertMessage {
  type: AlertType;
  title: string;
  body: string;
  link?: string;
  dedupeKey: string;
}

/**
 * An alert delivery channel. In-app is always on (alerts are stored in the Alert table).
 * Additional channels (email, SMS, push) implement this interface and are registered below.
 */
export interface AlertChannel {
  id: string;
  enabled(): boolean;
  deliver(alert: AlertMessage): Promise<void>;
}

/** Email channel placeholder — enable by configuring SMTP_* env vars and implementing send. */
export const emailChannel: AlertChannel = {
  id: "email",
  enabled: () => Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO),
  async deliver(alert) {
    // Intentionally not implemented yet: plug in nodemailer or a transactional email API here.
    // Do not include private agency notes in email bodies unless the channel is trusted.
    console.info(`[alerts:email] would send "${alert.title}" to ${process.env.ALERT_EMAIL_TO}`);
  },
};

export const extraChannels: AlertChannel[] = [emailChannel];
