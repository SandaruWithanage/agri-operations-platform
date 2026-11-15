-- Additional read filters do not change authority, statuses or existing rows.
CREATE INDEX farmer_status_id_idx ON farm.farmer(status,id);
