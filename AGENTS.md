# Non negotiables

1. Обязательно прочитай `./README.md` и `./STRATEGY.md`
2. Код обязан работать без вмешательства человека
3. Код обязан учитывать стадии развития колонии. Потому что не всегда стратегическое решение может подходить под текущий прогресс
4. После изменения кода убедись, что верхнеуровневая стратегия верно описана в `./STRATEGY.md`
5. Screeps - комплексная игра. Поэтому стоит предпочитать простые решения сложным, чтобы сложность всей системы росла постепенно

## Documentation

- API: https://docs.screeps.com/api/

## Screeps tips from [justjavac/screeps-tips](https://github.com/justjavac/screeps-tips) (may be outdated, has been writen many years ago)

1. To save your CPU, use less creeps of a larger size.
2. A good way to save CPU is caching often-used paths.
3. The more body parts of one type a creep has, the greater its productivity.
4. Use storage to not lose surplus of mined resources.
5. A resource abandoned on the ground eventually vanishes.
6. Use towers to set up automatic defense of your room.
7. The more small objects in the Memory, the more CPU spent on its parsing.
8. Inscreasing the `reusePath` option in the `Creep.moveTo` method helps saving CPU.
9. The `RANGED_ATTACK` body part is 3 times weaker than `ATTACK` and 2 times costlier at that.
10. You can have as many rooms under your control as your Global Control Level.
11. You can address from your script only those rooms that contain your creeps or structures.
12. Observers allow to get the `Room` object for the rooms that have no objects of yours.
13. Build roads to save on `MOVE` body parts of your creeps.
14. Roads wear out as they are used, so don’t forget to repair them.
15. Walls, roads, and containers don’t belong to any player, so they should be searched with the help of `FIND_STRUCTURES`, not `FIND_MY_STRUCTURES`.
16. Use try/catch blocks in right places to avoid a complete halt of your script due to errors.
17. Use branches to test and debug your temporary code and also do backups.
18. Set up a grunt task to write scripts on your local machine and commit them to Screeps.
19. More spawns in a room allows building more creeps at a time.
20. The more spawn extensions in a room, the more energy you can spend on building one creep.
21. Spawn extensions capacity increases on room levels 7 and 8.
22. Spawn extensions do not have to be placed near spawns, their range is the whole room.
23. Towers can aim at any object in a room even through walls and obstacles.
24. A tower’s effectiveness depends on the distance to the target.
25. Power banks appear only in neutral rooms that divide living sectors on the map.
26. Ramparts can be built not just on empty squares but on existing structures too.
27. While not destroyed, a rampart protects a creep or building on its square from any type of attack.
28. Creeps cannot move faster than 1 square per tick.
29. Use links to save on creep building and CPU.
30. Links can pass energy to other links at any point inside the same room.
31. You can build and repair roads and containers in any rooms, even neutral ones.
32. Leaderboards reset to zero each month, while your game process continues.
33. Modular architecture of a script will allow easy testing of individual functions in the simulator.
34. You can create any objects in the simulator to test your script.
35. The `console.log` function of the simulator displays a live expandable object in the browser console.
36. Walking over swamps is 5 times slower compared to plain land.
37. Ramparts and walls initially have 1 hit point. Repair them after construction.
38. You cannot have more than 3 rooms in the Novice Area.
39. If you want to play from scratch, you can always Respawn in a new room.
40. Every creep dies after 1500 ticks, however you can prolong its life using the `Spawn.renewCreep` method.
41. To control a room continuously, you need to upgrade your controller from time to time.
42. A spawn automatically replenishes itself with power until the energy in the room reaches 300 units.
43. Test various game scenarios in the simulator in order to be prepared for surprises.
44. Always try to control as many rooms as your GCL allows. It will allow your colony to develop at the maximum speed.
45. You can use more CPU than your CPU limit allows in short bursts.
46. Unless you use up your CPU limit each tick, it is stored for future use.
47. There is a keyword `debugger` in the simulator that stops your script in the browser.
48. Your CPU Limit depends on your Global Control Level.
49. Send emails to yourself with the function `Game.notify` to be aware of everything happening in the game.
50. The `Game.notify` function automatically groups identical messages using the specified interval.
51. It is too costly and senseless to maintain an army of military creeps in the peacetime.
52. The creep memory is saved upon death, so clear `Memory.creeps.*` to prevent overflowing.
53. You can output HTML content to the console, like links to rooms.
54. Each game action has a constant cost of 0.2 CPU.
55. Creeps can miss each other if they walk towards each other simultaneously or follow step by step.
56. A creep can execute some commands simultaneously in one tick, for example `move`+`build`+`dropEnergy`.
57. `require` spends CPU depending on the size and complexity of the module loaded.
58. Use loop architecture to save CPU on the logic you do not have to run each tick.
59. The game is fully recorded, so you can see replay of any room for the past several days.
60. If CPU limit raises, your script will execute only partially.
61. To output an object content into the console, use `JSON.stringify`.
62. A creep with an `ATTACK` part automatically strikes back at every attacker by `ATTACK`.
63. Respawning in a chosen room would automatically destroy all structures except walls and roads.
64. You can apply `transfer` and `heal` to another player’s creep, and `transfer,` `build` and `repair` to others’ structures.
65. To prevent other players from seizing a neutral room you want, use `Creep.reserveController`.
66. Energy in a storage can not be used to spawn creeps. Transfer it to a spawn or extensions instead.
67. You can speed up downgrading of hostile room controller by using `Creep.attackController` on it.
68. Sources in neutral rooms have reduced capacity. Reserve or claim the room to restore it to full capacity.
69. Use `Room.energyAvailable` and `Room.energyCapacityAvailable` to determine how much energy all the spawns and extensions in the room contain.
70. Dead body parts have weight and generate fatigue as well.
