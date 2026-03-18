const fs = require('fs');
const path = require('path');

const fixturesPath = path.join(__dirname, '../tests/fixtures/bridge-fixtures.json');
const f = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

const modifyB64 = fs.readFileSync('/tmp/modify_fixture.b64', 'utf-8').trim();
f.modifyResponse = {
  base64: modifyB64,
  expected: {
    "$class": "LookinConnectionResponseAttachment",
    data: {
      "$class": "LookinDisplayItemDetail",
      frameValue: [10, 20, 200, 100],
      boundsValue: [0, 0, 200, 100],
      hiddenValue: false,
      alphaValue: 1.0,
      attributesGroupList: [
        {
          "$class": "LookinAttributesGroup",
          identifier: "UIView",
          attrSections: [
            {
              "$class": "LookinAttributesSection",
              identifier: "UIView_Section_0",
              attributes: [
                { "$class": "LookinAttribute", identifier: "vl_v_h", value: false, attrType: 14 },
                { "$class": "LookinAttribute", identifier: "vl_v_o", value: 1.0, attrType: 12 }
              ]
            }
          ]
        }
      ]
    }
  }
};

fs.writeFileSync(fixturesPath, JSON.stringify(f, null, 2) + '\n');
console.log('Done. Keys:', Object.keys(f));
