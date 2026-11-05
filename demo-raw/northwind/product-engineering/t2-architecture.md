---
title: T2 architecture
author: tobias
date: 2026-08-18
---

# T2 architecture

Date: 2026-08-18. Author: Tobias Weber, Head of Engineering.

## Overview

The T2 is our mid-drive e-bike. The drive unit sits in the bottom bracket, so the motor works through the gears and the rider feels the bike respond to the terrain. This note describes how the parts fit together, not what the bike will cost or when it reaches the market.

## Drive and mechanics

The mid-drive motor delivers 85 Nm of torque. The motor controller sits next to it in a sealed housing. The frame comes from Rahmenbau Nord, which builds the frame to our geometry and welds the mounts for the drive unit and the battery.

## Battery

The energy store is a 720 Wh pack from Cellwerk GmbH. The pack is removable, and the mounting points are designed so the rider can lock it in place. The battery management system (BMS) sits inside the pack housing and reports to the motor controller over CAN.

Ingrid Kowalski designed the BMS for T2 and deserves the credit for the balancing and state-of-charge work that makes this pack reliable.

## Firmware stack

The firmware runs in three layers. The bottom layer handles the motor drive and the sensors. The middle layer runs the control loops for assist level and the thermal limits. The top layer talks to the display and to the app. Each layer has its own tests, and the middle layer is the one that changes most often between builds.

## Prototype

Prototype build 3 is assembled in Berlin. It carries the production drive unit, the Cellwerk pack and the firmware stack described above. Build 3 is the first one we use for the full ride tests, and the results go into the next revision of the requirements.

## Open items

The motor cooling needs one more check under long climbs. The firmware team owns the control loop tuning, and mechanical owns the cooling check. Both come back to this note when they are done.
