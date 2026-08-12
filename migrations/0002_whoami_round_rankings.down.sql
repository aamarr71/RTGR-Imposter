-- Rollback zu 0002_whoami_round_rankings.

drop table if exists whoami_round_progress;
drop index if exists room_players_room_id_id_unique;
