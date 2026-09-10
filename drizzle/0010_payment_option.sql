-- Two DISPLAY columns, and the first one has to stay that way.
--
-- `payment_option` says which way to pay a subscription was bought on —
-- "monthly", "yearly", the key out of `paymentOptions` in the registry. With
-- payment options both buyers hold the SAME Product Key and the same
-- entitlement, so gating anything on this column would invent a difference the
-- vendor never sold. Access is `hasPlan(memberId, productKey)`, here as
-- everywhere.
--
-- `switch_interval_url` is Digistore24's own page for changing that interval.
-- It only leads anywhere once the product carries several payment plans, which
-- is what `ds24-sync` now writes.
--
-- Both are NULL on every existing row and stay NULL until the next IPN for
-- that purchase — a rebill, a refund, a cancellation. Nothing reads them as
-- anything but "not known yet", so there is no backfill to do.
ALTER TABLE "subscriptions" ADD COLUMN "payment_option" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "switch_interval_url" text;