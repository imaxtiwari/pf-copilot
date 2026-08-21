-- Add AMFI category column to the scheme master for allocation classification.
ALTER TABLE amfi_scheme_master
  ADD COLUMN amfi_category text;
