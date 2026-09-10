import assert from "node:assert/strict";import test from "node:test";
import {contractUtilization,isCautiousSignal,missingRequired,nextLegalVersion} from "../lib/legal.ts";
test("contract utilization exposes limit excess",()=>assert.equal(contractUtilization(50000000,54000000),108));
test("required missing documents remain visible",()=>assert.equal(missingRequired([{required:true,status:"Отсутствует"},{required:false,status:"Отсутствует"},{required:true,status:"Актуален"}]),1));
test("legal versions only append",()=>assert.equal(nextLegalVersion(2),3));
test("legal signals avoid accusations",()=>{assert.equal(isCautiousSignal("Возможный конфликт · сигнал","Требует проверки"),true);assert.equal(isCautiousSignal("Нарушитель",""),false)});
