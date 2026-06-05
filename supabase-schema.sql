-- ============================================================
-- Warehouse Scanner — Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- 1. Profiles table (extends Supabase auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  role text not null default 'packer' check (role in ('packer', 'admin')),
  created_at timestamp with time zone default now()
);

-- 2. Scans table
create table if not exists scans (
  id uuid default gen_random_uuid() primary key,
  packer_id uuid references profiles(id) not null,
  packer_username text not null,
  tracking_number text not null,
  platform text not null check (platform in ('WhatNot', 'TikTok')),
  scanned_at timestamp with time zone default now()
);

-- 3. Enable Row Level Security
alter table profiles enable row level security;
alter table scans enable row level security;

-- 4. RLS Policies — profiles
-- Users can read their own profile
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Admins can view all profiles
create policy "Admins can view all profiles"
  on profiles for select
  using (
    exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Admins can insert new profiles
create policy "Admins can insert profiles"
  on profiles for insert
  with check (
    exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 5. RLS Policies — scans
-- Packers can insert their own scans
create policy "Packers can insert own scans"
  on scans for insert
  with check (auth.uid() = packer_id);

-- Packers can view their own scans
create policy "Packers can view own scans"
  on scans for select
  using (auth.uid() = packer_id);

-- Admins can view all scans
create policy "Admins can view all scans"
  on scans for select
  using (
    exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 6. Function to auto-create profile after signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, username, role)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'role', 'packer')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to call the function on signup
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- 7. Indexes for performance
create index if not exists scans_packer_id_idx on scans(packer_id);
create index if not exists scans_scanned_at_idx on scans(scanned_at desc);
create index if not exists scans_platform_idx on scans(platform);
