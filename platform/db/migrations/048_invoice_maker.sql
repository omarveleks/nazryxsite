-- The invoice maker: invoices for anyone (not only portal accounts), kept with what they say and the A4 page itself.
alter table invoices alter column user_id drop not null;
alter table invoices add column kind text not null default 'Invoice', add column bill_to text, add column data jsonb, add column html text,
  add column created_by uuid references users(id) on delete set null;
create policy invoices_team_insert on invoices for insert with check (app_is_team());
create policy invoices_team_delete on invoices for delete using (app_is_team());
grant insert, delete on invoices to nazryx_app;
grant usage on sequence invoices_id_seq to nazryx_app;
