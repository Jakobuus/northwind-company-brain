---
title: BMS explained in plain words
author: ingrid
date: 2026-08-04
---

# BMS explained in plain words

Everyone at Northwind talks about the battery, but fewer people know what keeps it safe. This note explains our battery management system, the BMS, in plain words. You do not need an electronics background to follow it.

## What a BMS does

The BMS is the small electronic board that sits between the battery pack from Cellwerk and the rest of the bike. The battery management system watches every cell, decides how much energy can flow in and out, and stops the pack before something goes wrong. Without a BMS, a lithium pack is a risk, not a product.

## Cell balancing

A pack is a chain of cells, and no two cells are exactly the same. Over many charge cycles, some cells fill faster than others. Cell balancing is the BMS task that evens them out. The BMS bleeds a little charge from the fullest cells, so the weakest cell does not hold back the whole pack. It is simple work, but it is the reason a pack still gives full range after a few hundred charges.

## State of charge

The percentage on the display is an estimate. The BMS cannot read the fuel level directly. It estimates the state of charge from voltage, current and history. Good estimates matter, because a display that says 20 percent and then shuts the bike off is the first thing riders complain about.

## Thermal cutoff

If a cell gets too hot, the BMS cuts the output. This thermal cutoff protects the rider and the pack. It is one reason a bike may slow down on a hot day under a heavy load, and why that is intended behaviour.

## Who to ask

Ingrid Kowalski is the contact for BMS questions. Send her the symptom, the firmware version and the battery serial number, and she will tell you whether the problem sits in the BMS or somewhere else.
