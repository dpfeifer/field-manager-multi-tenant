-- Accepting a booking request now drafts a quote with the requester as a
-- prospect (not a customer + job). Track the resulting quote so we can
-- link to it from the Requests list.
ALTER TABLE booking_requests
  ADD COLUMN created_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL;
