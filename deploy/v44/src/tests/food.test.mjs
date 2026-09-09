import assert from"node:assert/strict";import test from"node:test";import{batchAfterWriteOff,expiryBand,foodEconomics,shipmentBalance}from"../lib/food.ts";
test("shipment closes to consumption returns and waste",()=>assert.equal(shipmentBalance({shippedPortions:80,consumedPortions:75,returnedPortions:3,writtenOffPortions:2}),0));
test("kitchen profitability keeps every cost",()=>assert.deepEqual(foodEconomics(3000000,1200000,800000),{revenueMinor:3000000,materialMinor:1200000,laborMinor:800000,profitMinor:1000000,marginPercent:33}));
test("expiry band uses explicit dates",()=>assert.equal(expiryBand("2026-08-23","2026-08-21"),"Срочно"));
test("batch cannot be written below zero",()=>{assert.equal(batchAfterWriteOff(3000,500),2500);assert.throws(()=>batchAfterWriteOff(300,500))});
