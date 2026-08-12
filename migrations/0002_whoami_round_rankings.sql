-- 0002_whoami_round_rankings: flüchtige Platzierung innerhalb einer Runde.
--
-- Die Daten werden beim Rundenende gelöscht. Es handelt sich ausdrücklich
-- nicht um ein dauerhaftes Punkte- oder Leaderboard-System.

-- Ermöglicht einen zusammengesetzten FK, damit ein Spieler nicht versehentlich
-- einem fremden Raum zugeordnet werden kann.
create unique index if not exists room_players_room_id_id_unique
  on room_players (room_id, id);

create table if not exists whoami_round_progress (
  room_id            uuid not null references rooms (id) on delete cascade,
  round_number       integer not null check (round_number >= 0),
  player_id          uuid not null,
  claim_id           uuid,
  claim_requested_at timestamptz,
  placement          integer check (placement >= 1),
  approved_at        timestamptz,
  automatic          boolean not null default false,
  primary key (room_id, round_number, player_id),
  constraint whoami_round_progress_player_in_room_fk
    foreign key (room_id, player_id)
    references room_players (room_id, id) on delete cascade,
  constraint whoami_round_progress_claim_complete
    check ((claim_id is null) = (claim_requested_at is null)),
  constraint whoami_round_progress_approval_complete
    check ((placement is null) = (approved_at is null)),
  constraint whoami_round_progress_auto_has_place
    check (not automatic or placement is not null),
  constraint whoami_round_progress_explicit_has_claim
    check (automatic or placement is null or claim_requested_at is not null)
);

-- Selbst bei einem Programmierfehler kann dieselbe Platznummer nicht zweimal
-- innerhalb desselben Raums und derselben Runde entstehen.
create unique index if not exists whoami_round_progress_place_unique
  on whoami_round_progress (room_id, round_number, placement)
  where placement is not null;

create index if not exists whoami_round_progress_round_idx
  on whoami_round_progress (room_id, round_number);
