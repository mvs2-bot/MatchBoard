-- MatchBoard: Mini-Competitions zwischen Stefan und Ines
-- Läuft im gemeinsamen Supabase-Core-Projekt (wie QuestLog und TravelBase), Tabellen mit Präfix matchboard_.
-- Gehört später ins Repo supabase-core (supabase/migrations/), liegt hier bis dahin zum Nachschlagen.
-- Einmalig im SQL Editor ausführen; das Skript ist wiederholbar (if not exists / on conflict).
--
-- Tabellen
--   matchboard_categories  Kategorien (Sport, Kartenspiele, …) mit Emoji und Farbe, ändern nur Admins
--   matchboard_locations   Orte mit Koordinaten für die Karte; mehrere Matches teilen sich einen Ort
--   matchboard_matches     ein Eintrag pro Match: Titel, Spiel, Kategorie, Datum, Ort, Ergebnis
--
-- Wer was darf (Zugang über overall_app_access, App "matchboard")
--   admin   (Stefan)  alles lesen und bearbeiten, Kategorien pflegen, jedes Match löschen
--   member  (Ines)    alles lesen, Matches und Orte anlegen und bearbeiten, eigene Matches löschen
--   Beide sehen dieselben Daten (gemeinsamer Stand, keine getrennten Sichten).
--   Globale Admins (z. B. das Konto "Claude") kommen über overall_app_role an die Daten,
--   zählen aber nicht als Spieler: Spieler sind nur Konten mit eigenem Eintrag in overall_app_access.

-- ───────────────────────── App + Zugang ─────────────────────────

insert into public.overall_apps (id, name, url, is_active)
values ('matchboard', 'MatchBoard', 'https://mvs2-bot.github.io/MatchBoard/', true)
on conflict (id) do nothing;

-- Stefan = admin, Ines = member (Zuordnung über den Anzeigenamen im globalen Profil)
insert into public.overall_app_access (user_id, app_id, role)
select p.id, 'matchboard', v.role
from (values ('Stefan', 'admin'), ('Ines', 'member')) as v(name, role)
join public.overall_profiles p on p.display_name = v.name
on conflict (user_id, app_id) do update set role = excluded.role;

-- ───────────────────────── Tabellen ─────────────────────────

create table if not exists public.matchboard_categories (
    id     text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
    label  text not null check (char_length(label) between 1 and 40),
    emoji  text not null default '🏆',
    color  text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),   -- Markerfarbe auf der Karte
    sort   int  not null default 100
);

create table if not exists public.matchboard_locations (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(trim(name)) between 1 and 120),   -- Anzeigename, z. B. "Strandbad Bruggerhorn"
    region      text check (region is null or char_length(region) <= 120),         -- z. B. "St. Margrethen, CH"
    lat         double precision not null check (lat between -90 and 90),
    lng         double precision not null check (lng between -180 and 180),
    created_by  uuid default auth.uid() references auth.users(id) on delete set null,
    created_at  timestamptz not null default now()
);
create unique index if not exists matchboard_locations_name_key on public.matchboard_locations (lower(trim(name)));

create table if not exists public.matchboard_matches (
    id           uuid primary key default gen_random_uuid(),
    title        text not null check (char_length(trim(title)) between 1 and 120),   -- z. B. "Kniffel Italien"
    game         text not null check (char_length(trim(game)) between 1 and 60),     -- Disziplin, z. B. "Kniffel" (Statistik je Spiel)
    category_id  text not null references public.matchboard_categories(id) on update cascade,
    played_on    date not null check (played_on >= date '2000-01-01'),
    location_id  uuid references public.matchboard_locations(id) on delete set null,
    outcome      text not null check (outcome in ('win', 'draw')),
    winner_id    uuid references auth.users(id) on delete restrict,                  -- null bei Unentschieden
    score        text check (score is null or char_length(score) <= 40),             -- optional, z. B. "10:7"
    guests       text[] not null default '{}' check (cardinality(guests) <= 10),     -- weitere Mitspieler ohne Konto, z. B. {Mohamed}
    notes        text check (notes is null or char_length(notes) <= 1000),
    created_by   uuid default auth.uid() references auth.users(id) on delete set null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    constraint matchboard_matches_winner_check check ((outcome = 'win') = (winner_id is not null))
);
create index if not exists matchboard_matches_played_on_idx on public.matchboard_matches (played_on desc, created_at desc);
create index if not exists matchboard_matches_location_idx on public.matchboard_matches (location_id);
create index if not exists matchboard_matches_category_idx on public.matchboard_matches (category_id);
create index if not exists matchboard_matches_winner_idx on public.matchboard_matches (winner_id);

-- ───────────────────────── Hilfsfunktionen ─────────────────────────

-- Spieler = Konten mit eigenem MatchBoard-Zugang (admin oder member). Nur für MatchBoard-Mitglieder abrufbar.
-- Liefert nur Name und Profilbild-Pfad, keine weiteren Profildaten.
create or replace function public.matchboard_players()
returns table (id uuid, display_name text, avatar_path text, role text)
language sql stable security definer set search_path = '' as $$
    select p.id, p.display_name, p.avatar_path, a.role
    from public.overall_app_access a
    join public.overall_profiles p on p.id = a.user_id
    where a.app_id = 'matchboard' and a.role in ('admin', 'member')
      and public.overall_has_app_role('matchboard', 'member')
    order by case a.role when 'admin' then 0 else 1 end, p.display_name;
$$;
revoke all on function public.matchboard_players() from public, anon;
grant execute on function public.matchboard_players() to authenticated;

-- Match prüfen: Gewinner muss Spieler sein, Datum nicht in der Zukunft, Anleger und Anlagezeit bleiben fest
create or replace function public.matchboard_check_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.winner_id is not null and not exists (
        select 1 from public.overall_app_access a
        where a.user_id = new.winner_id and a.app_id = 'matchboard' and a.role in ('admin', 'member')
    ) then
        raise exception 'Gewinner muss Stefan oder Ines sein.' using errcode = 'P0001';
    end if;
    if (tg_op = 'INSERT' or new.played_on is distinct from old.played_on)
       and new.played_on > (now() at time zone 'Europe/Berlin')::date then
        raise exception 'Das Datum darf nicht in der Zukunft liegen.' using errcode = 'P0001';
    end if;
    new.title := trim(new.title);
    new.game := trim(new.game);
    if tg_op = 'UPDATE' then
        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.updated_at := now();
    end if;
    return new;
end $$;

drop trigger if exists matchboard_matches_check on public.matchboard_matches;
create trigger matchboard_matches_check before insert or update on public.matchboard_matches
    for each row execute function public.matchboard_check_match();

-- ───────────────────────── Zugriffsregeln (RLS) ─────────────────────────

alter table public.matchboard_categories enable row level security;
alter table public.matchboard_locations  enable row level security;
alter table public.matchboard_matches    enable row level security;

revoke all on public.matchboard_categories, public.matchboard_locations, public.matchboard_matches from anon;
grant select, insert, update, delete on public.matchboard_categories, public.matchboard_locations, public.matchboard_matches to authenticated;
grant select, insert, update, delete on public.matchboard_categories, public.matchboard_locations, public.matchboard_matches to service_role;

-- Kategorien: lesen alle Mitglieder, pflegen nur Admins
drop policy if exists matchboard_categories_select on public.matchboard_categories;
create policy matchboard_categories_select on public.matchboard_categories for select to authenticated
    using ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_categories_write on public.matchboard_categories;
create policy matchboard_categories_write on public.matchboard_categories for all to authenticated
    using ((select public.overall_has_app_role('matchboard', 'admin')))
    with check ((select public.overall_has_app_role('matchboard', 'admin')));

-- Orte: lesen, anlegen, ändern alle Mitglieder; löschen nur Admins (Matches behalten dann keinen Ort)
drop policy if exists matchboard_locations_select on public.matchboard_locations;
create policy matchboard_locations_select on public.matchboard_locations for select to authenticated
    using ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_locations_insert on public.matchboard_locations;
create policy matchboard_locations_insert on public.matchboard_locations for insert to authenticated
    with check ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_locations_update on public.matchboard_locations;
create policy matchboard_locations_update on public.matchboard_locations for update to authenticated
    using ((select public.overall_has_app_role('matchboard', 'member')))
    with check ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_locations_delete on public.matchboard_locations;
create policy matchboard_locations_delete on public.matchboard_locations for delete to authenticated
    using ((select public.overall_has_app_role('matchboard', 'admin')));

-- Matches: gemeinsamer Stand, beide lesen und bearbeiten alles; löschen Admins oder wer es angelegt hat
drop policy if exists matchboard_matches_select on public.matchboard_matches;
create policy matchboard_matches_select on public.matchboard_matches for select to authenticated
    using ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_matches_insert on public.matchboard_matches;
create policy matchboard_matches_insert on public.matchboard_matches for insert to authenticated
    with check ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_matches_update on public.matchboard_matches;
create policy matchboard_matches_update on public.matchboard_matches for update to authenticated
    using ((select public.overall_has_app_role('matchboard', 'member')))
    with check ((select public.overall_has_app_role('matchboard', 'member')));
drop policy if exists matchboard_matches_delete on public.matchboard_matches;
create policy matchboard_matches_delete on public.matchboard_matches for delete to authenticated
    using ((select public.overall_has_app_role('matchboard', 'admin'))
           or (created_by = (select auth.uid()) and (select public.overall_has_app_role('matchboard', 'member'))));

-- ───────────────────────── Seed ─────────────────────────

insert into public.matchboard_categories (id, label, emoji, color, sort) values
    ('sport',     'Sport',                       '⚽', '#16a34a', 10),
    ('geschick',  'Geschicklichkeit',            '🎯', '#ea580c', 20),
    ('karten',    'Kartenspiele',                '🃏', '#dc2626', 30),
    ('wuerfel',   'Würfelspiele',                '🎲', '#7c3aed', 40),
    ('brett',     'Gesellschafts- & Brettspiele', '♟️', '#0891b2', 50),
    ('quiz',      'Quiz & Wissen',               '🧠', '#db2777', 60),
    ('video',     'Videospiele',                 '🎮', '#2563eb', 70),
    ('sonstiges', 'Sonstiges',                   '✨', '#64748b', 99)
on conflict (id) do nothing;

-- Koordinaten auf den Ort bzw. die Ortsmitte gesetzt; lassen sich in der App korrigieren
insert into public.matchboard_locations (name, region, lat, lng) values
    ('Bregenz',                  'Vorarlberg, AT',          47.5031,  9.7471),
    ('Strandbad Bruggerhorn',    'St. Margrethen, CH',      47.4505,  9.6580),
    ('Camping Werdenberg',       'Buchs SG, CH',            47.1659,  9.4651),
    ('Frutigresort',             'Frutigen, CH',            46.5870,  7.6440),
    ('Blüemlisalphütte',         'Kandersteg, CH',          46.4950,  7.7630),
    ('Zürich',                   'Zürich, CH',              47.3769,  8.5417),
    ('Reschensee',               'Vinschgau, IT',           46.8100, 10.5300)
on conflict ((lower(trim(name)))) do nothing;

-- Die 12 Matches vom Sommer 2026, nur wenn die Tabelle noch leer ist
insert into public.matchboard_matches (title, game, category_id, played_on, location_id, outcome, winner_id, guests, notes)
select s.title, s.game, s.category_id, s.played_on, l.id, 'win', p.id, s.guests, s.notes
from (values
    ('Mülleimer werfen', 'Mülleimer werfen', 'geschick', date '2026-07-18', 'Bregenz',               'Ines',   '{}'::text[], null),
    ('Kickern',          'Kickern',          'sport',    date '2026-07-18', 'Strandbad Bruggerhorn', 'Stefan', '{}',         null),
    ('Kniffel',          'Kniffel',          'wuerfel',  date '2026-07-18', 'Strandbad Bruggerhorn', 'Stefan', '{}',         null),
    ('Minigolf',         'Minigolf',         'sport',    date '2026-07-19', 'Camping Werdenberg',    'Stefan', '{}',         null),
    ('Fippern',          'Flippern',         'geschick', date '2026-07-19', 'Camping Werdenberg',    'Stefan', '{}',         null),
    ('Minigolf',         'Minigolf',         'sport',    date '2026-07-20', 'Frutigresort',          'Ines',   '{}',         null),
    ('Kniffeln Hütte',   'Kniffel',          'wuerfel',  date '2026-07-21', 'Blüemlisalphütte',      'Ines',   '{}',         null),
    ('Kickern Mohamed',  'Kickern',          'sport',    date '2026-07-24', 'Zürich',                'Stefan', '{Mohamed}',  'Match mit Mohamed'),
    ('Minigolf Zürich',  'Minigolf',         'sport',    date '2026-07-24', 'Zürich',                'Ines',   '{}',         null),
    ('Kickern Italien',  'Kickern',          'sport',    date '2026-07-25', 'Reschensee',            'Stefan', '{}',         null),
    ('Kniffel Italien',  'Kniffel',          'wuerfel',  date '2026-07-25', 'Reschensee',            'Ines',   '{}',         null),
    ('Bogenschießen',    'Bogenschießen',    'sport',    date '2026-07-25', 'Reschensee',            'Stefan', '{}',         null)
) as s(title, game, category_id, played_on, place, winner, guests, notes)
join public.matchboard_locations l on lower(l.name) = lower(s.place)
join public.overall_profiles p on p.display_name = s.winner
where not exists (select 1 from public.matchboard_matches);
