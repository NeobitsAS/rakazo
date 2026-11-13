-- Fork: a routine run that sends its reply to the bot's linked chat (deliverToMessaging) gets the
-- same backup reply job as a chat-started run. Upstream defines this trigger in
-- 20261214120000_run_reply_delivery_job; re-check it on every sync, since a later upstream
-- migration that recreates it would drop the deliverToMessaging condition.
DROP TRIGGER IF EXISTS runs_schedule_reply_delivery ON runs;
CREATE TRIGGER runs_schedule_reply_delivery AFTER UPDATE OF status ON runs
FOR EACH ROW
WHEN (
  NEW.status IS DISTINCT FROM OLD.status
  AND NEW.status IN ('completed', 'failed', 'cancelled')
  AND (NEW.trigger IN ('messaging', 'bot_message') OR NEW."deliverToMessaging")
)
EXECUTE FUNCTION schedule_run_reply_delivery();
