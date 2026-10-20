-- MatchBoard: Profilbild des Mitspielers sichtbar machen
-- Profilbilder liegen global im privaten Bucket "avatars" (Pfad in overall_profiles.avatar_path).
-- Das eigene Bild darf jeder sehen (Policy avatars_select_own). Diese Migration erlaubt MatchBoard-Spielern
-- zusätzlich, die Bilder der anderen MatchBoard-Spieler zu sehen (Stefan ↔ Ines), wie questlog_avatars_select beim Quest Log.
-- Einmalig im SQL Editor ausführen; wiederholbar.

create or replace function public.matchboard_avatar_visible(p_object text)
returns boolean language sql stable security definer set search_path = '' as $$
    select public.overall_has_app_role('matchboard', 'member') and exists (
        select 1
        from public.overall_profiles o
        join public.overall_app_access a on a.user_id = o.id and a.app_id = 'matchboard' and a.role in ('admin', 'member')
        where o.avatar_path = p_object
    );
$$;
revoke all on function public.matchboard_avatar_visible(text) from public, anon;
grant execute on function public.matchboard_avatar_visible(text) to authenticated;

drop policy if exists matchboard_avatars_select on storage.objects;
create policy matchboard_avatars_select on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and public.matchboard_avatar_visible(name));
