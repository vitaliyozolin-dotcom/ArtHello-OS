import assert from "node:assert/strict";import test from "node:test";import{monthlyDepreciation,offerScore,stockAfter,warrantyState}from"../lib/procurement.ts";
test("offer comparison balances price and quality",()=>{const selected=offerScore({priceMinor:48000000,deliveryDays:5,warrantyMonths:24,qualityScore:91},45200000),cheap=offerScore({priceMinor:45200000,deliveryDays:8,warrantyMonths:12,qualityScore:76},45200000);assert.ok(selected>cheap)});
test("stock events never create negative inventory",()=>{assert.equal(stockAfter(8,"Выдача",2),6);assert.throws(()=>stockAfter(1,"Списание",2))});
test("depreciation is reproducible in minor units",()=>assert.equal(monthlyDepreciation(4800000,24),200000));
test("warranty is based on explicit date",()=>assert.equal(warrantyState("2028-08-09","2026-08-21"),"На гарантии"));
