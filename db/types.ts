export type WaitlistInput = {
  email: string;
  role?: string;
  experience?: string;
  discord?: string;
  github?: string;
  country?: string;
  utm?: Record<string, string>;
  ref?: string;            // referral code of the referrer
};
