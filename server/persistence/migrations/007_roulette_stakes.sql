ALTER TABLE casino_wagers DROP CONSTRAINT casino_wagers_stake_check;
ALTER TABLE casino_wagers ADD CONSTRAINT casino_wagers_stake_check
 CHECK(stake > 0 AND stake <= CASE WHEN game='roulette' THEN 1000 ELSE 100 END);
