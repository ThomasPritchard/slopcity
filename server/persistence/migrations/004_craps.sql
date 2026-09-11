ALTER TABLE casino_wagers DROP CONSTRAINT casino_wagers_game_check;
ALTER TABLE casino_wagers ADD CONSTRAINT casino_wagers_game_check CHECK(game IN ('roulette','blackjack','slots','craps'));
