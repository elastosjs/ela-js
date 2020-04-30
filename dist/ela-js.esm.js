import _defineProperty from '@babel/runtime/helpers/defineProperty';
import _ from 'lodash';
import _regeneratorRuntime from '@babel/runtime/regenerator';
import _asyncToGenerator from '@babel/runtime/helpers/asyncToGenerator';
import _classCallCheck from '@babel/runtime/helpers/classCallCheck';
import _createClass from '@babel/runtime/helpers/createClass';
import Web3 from 'web3';
import check from 'check-types';

var bytes32ToStr = function bytes32ToStr(buf) {
  return _.trimStart(buf.toString(), "\0");
};

var bytes32ToUint = function bytes32ToUint(buf) {
  var buf4 = new Buffer.alloc(4);
  buf.copy(buf4, 0, 28);
  return parseInt(buf4.readUInt32BE().toString(10));
};

var bytesToTypes = {
  bytes32ToStr: bytes32ToStr,
  bytes32ToUint: bytes32ToUint
};

// we use this over Web3.utils.numberToHex because this pads
// extra 0's to ensure it's 32 bytes to the left, however strings read
// left to right so we don't care
var uintToBytes32 = function uintToBytes32(input) {
  var inputBuf = new Buffer.alloc(4);
  inputBuf.writeUInt32BE(input);
  var targetBuf = new Buffer.alloc(32);
  inputBuf.copy(targetBuf, 28);
  return '0x' + targetBuf.toString('hex');
};

var _require = require('sha3'),
    Keccak = _require.Keccak;

var sha3 = new Keccak(256);

function namehashInner(input) {
  if (input === '') {
    return new Buffer.alloc(32);
  }

  var inputSplit = input.split('.');
  var label = inputSplit.shift();
  var remainder = inputSplit.join('.');
  var labelSha3 = sha3.update(label).digest(); // console.log(labelSha3.toString('hex'))

  sha3.reset();
  var iter = sha3.update(Buffer.concat([namehashInner(remainder), labelSha3])).digest();
  sha3.reset(); // TODO: figure out why this needs to be here

  return iter;
}

function namehash(input) {
  return '0x' + namehashInner(input).toString('hex');
}
 // 0000000000000000000000000000000000000000000000000000000000000000

var _require$1 = require('sha3'),
    Keccak$1 = _require$1.Keccak;

var sha3$1 = new Keccak$1(256);

function keccak256(input) {
  if (input.substring(0, 2) === '0x') {
    input = Buffer.from(input.substring(2), 'hex');
  }

  sha3$1.reset();
  var hash = sha3$1.update(input).digest();
  return '0x' + hash.toString('hex');
}

var fileName = "ELAJSStore.sol";
var contractName = "ELAJSStore";
var source = "pragma solidity ^0.5.0;\npragma experimental ABIEncoderV2;\n\nimport \"sol-datastructs/src/contracts/PolymorphicDictionaryLib.sol\";\n\n// import \"sol-datastructs/src/contracts/Bytes32DictionaryLib.sol\";\nimport \"sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol\";\n\n// import \"./oz/EnumerableSetDictionary.sol\";\n\nimport \"sol-sql/src/contracts/src/structs/TableLib.sol\";\n\nimport \"./ozEla/OwnableELA.sol\";\nimport \"./gsnEla/GSNRecipientELA.sol\";\nimport \"./gsnEla/IRelayHubELA.sol\";\n\n// TODO: move schema methods to another contract, we're hitting limits for this\n// TODO: good practice to have functions not callable externally and internally\ncontract ELAJSStore is OwnableELA, GSNRecipientELA {\n\n    uint constant DAY_IN_SECONDS = 86400;\n\n    // TODO: have a dynamic mode to only use Events -> https://thegraph.com\n    // bool public useEvents = false;\n\n    // This counts the number of times this contract was called via GSN (expended owner gas) for rate limiting\n    // mapping is a keccak256('YYYY-MM-DD') => uint (TODO: we can probably compress this by week (4 bytes per day -> 28 bytes)\n    mapping(uint256 => uint256) public gsnCounter;\n\n    // Max times we allow this to be called per day\n    uint40 public gsnMaxCallsPerDay;\n\n    using PolymorphicDictionaryLib for PolymorphicDictionaryLib.PolymorphicDictionary;\n    using Bytes32SetDictionaryLib for Bytes32SetDictionaryLib.Bytes32SetDictionary;\n\n    // _table = system table (bytes32 Dict) of each table's metadata marshaled\n    // 8 bits - permissions (00 = system, 01 = private, 10 = public, 11 = shared - owner can always edit)\n    // 20 bytes - address delegate - other address allowed to edit\n    mapping(bytes32 => bytes32) internal _table;\n\n    // table = dict, where the key is the table, and the value is a set of byte32 ids\n    Bytes32SetDictionaryLib.Bytes32SetDictionary internal tableId;\n\n    // Schema dictionary, key (schemasPublicTables) points to a set of table names\n    using TableLib for TableLib.Table;\n    using TableLib for bytes;\n    // using ColumnLib for ColumnLib.Column;\n    // using ColumnLib for bytes;\n\n    // schemaTables -> Set of tables (raw table name values) for enumeration\n    bytes32 constant public schemasTables = 0x736368656d61732e7075626c69632e7461626c65730000000000000000000000;\n\n    // namehash([tableName]) => encoded table schema\n    // ownership of each row (id) - key = namehash([id].[table]) which has a value that is the owner's address\n    // ultimately namehash([field].[id].[table]) gives us a bytes32 which maps to the single data value\n    PolymorphicDictionaryLib.PolymorphicDictionary internal database;\n\n\n    // ************************************* SETUP FUNCTIONS *************************************\n    function initialize(address relayHubAddr) public initializer {\n        OwnableELA.initialize(msg.sender);\n        GSNRecipientELA.initialize(relayHubAddr);\n        _initialize();\n    }\n\n    function _initialize() internal {\n        gsnMaxCallsPerDay = uint40(1000);\n\n        // init the key for schemasTables, our set is one-to-many-fixed, so table names must be max 32 bytes\n        database.addKey(schemasTables, PolymorphicDictionaryLib.DictionaryType.OneToManyFixed);\n    }\n\n    // ************************************* SCHEMA FUNCTIONS *************************************\n    /**\n     * @dev create a new table, only the owner may create this\n     *\n     * @param tableName right padded zeroes (Web3.utils.stringToHex)\n     * @param tableKey this is the namehash of tableName\n     */\n    function createTable(\n        bytes32 tableName,\n        bytes32 tableKey,\n        uint8 permission,\n        bytes32[] memory columnName,\n        bytes32[] memory columnDtype\n\n    ) public onlyOwner {\n\n        // this only works if tableName is trimmed of padding zeroes, since this is an onlyOwner call we won't bother\n        // require(isNamehashSubOf(keccak256(tableNameBytes), bytes32(0), tableKey), \"tableName does not match tableKey\");\n\n        // check if table exists\n        require(_table[tableKey] == 0, \"Table already exists\");\n\n        address delegate = address(0x0);\n\n        // claim the key slot and set the metadata\n        setTableMetadata(tableKey, permission, delegate);\n\n        database.addValueForKey(schemasTables, tableName);\n\n        // table stores the row ids set as the value, set up the key\n        tableId.addKey(tableKey);\n\n        // now insert the schema\n        saveSchema(tableName, tableKey, columnName, columnDtype);\n    }\n\n    // TODO: this isn't complete\n    function deleteTable(\n        bytes32 tableName,\n        bytes32 tableKey\n    ) public onlyOwner {\n        _table[tableKey] = 0;\n        database.removeValueForKey(schemasTables, tableName);\n        tableId.removeKey(tableKey);\n    }\n\n    function getTables() external view returns (bytes32[] memory){\n        return database.enumerateForKeyOneToManyFixed(schemasTables);\n    }\n\n    /*\n    function tableExists(bytes32 tableKey) public view returns (bool) {\n        return tableId.containsKey(tableKey);\n    }\n    */\n\n    function saveSchema(\n        bytes32 tableName,\n        bytes32 tableKey,\n        bytes32[] memory columnName,\n        bytes32[] memory columnDtype\n\n    ) public onlyOwner returns (bool) {\n\n        TableLib.Table memory tableSchema = TableLib.create(\n            tableName,\n            columnName,\n            columnDtype\n        );\n\n        bytes memory encoded = tableSchema.encode();\n\n        // we store the encoded table schema on the base tableKey\n        return database.setValueForKey(tableKey, encoded);\n    }\n\n    // EXPERIMENTAL\n    function getSchema(bytes32 _name) public view returns (TableLib.Table memory) {\n        bytes memory encoded = database.getBytesForKey(_name);\n        return encoded.decodeTable();\n    }\n\n    // ************************************* CRUD FUNCTIONS *************************************\n\n    /**\n     * @dev Table level permission checks\n     */\n    modifier insertCheck(bytes32 tableKey) {\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot INSERT into system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can INSERT into this table\");\n\n        _;\n    }\n\n\n    /**\n     * Primarily exists to assist in query WHERE searches, therefore we\n     * want the index to exist on the value and table, filtering on owner\n     * is important for performance\n     */\n    event InsertVal (\n        bytes32 indexed tableKey,\n        bytes32 indexed fieldKey,\n        bytes32 indexed val,\n\n        bytes32 id,\n\n        address owner\n    );\n\n\n    /**\n     * @dev Prior to insert, we check the permissions and autoIncrement\n     * TODO: use the schema and determine the proper type of data to insert\n     *\n     * @param tableKey the namehashed [table] name string\n     * @param idKey the sha3 hashed idKey\n     * @param id as the raw string (unhashed)\n     */\n    function insertVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes32 val)\n\n    public insertCheck(tableKey){\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        require(database.containsKey(fieldIdTableKey) == false, \"id+field already exists\");\n\n        // increment counter\n        increaseGsnCounter();\n\n        // add an id entry to the table's set of ids for the row (this is a set so we don't need to check first)\n        // TODO: should we check the id/row ownership?\n        tableId.addValueForKey(tableKey, id);\n\n        // add the \"row owner\" if it doesn't exist, the row may already exist in which case we don't update it\n        if (database.containsKey(idTableKey) == false){\n            _setRowOwner(idTableKey, id, tableKey);\n        }\n\n        // finally set the data\n        // we won't serialize the type, that's way too much redundant data\n        database.setValueForKey(fieldIdTableKey, bytes32(val));\n\n        // emit an event to assist in queries\n        emit InsertVal(tableKey, fieldKey, val, id, _msgSender());\n\n    }\n\n    function insertValVar(\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes memory val)\n\n    public insertCheck(tableKey){\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        require(database.containsKey(fieldIdTableKey) == false, \"id+field already exists\");\n\n        // increment counter\n        increaseGsnCounter();\n\n        // add an id entry to the table's set of ids for the row\n        tableId.addValueForKey(tableKey, id);\n\n        // add the \"row owner\" if it doesn't exist, the row may already exist in which case we don't update it\n        if (database.containsKey(idTableKey) == false){\n            _setRowOwner(idTableKey, id, tableKey);\n        }\n\n        // finally set the data\n        database.setValueForKey(fieldIdTableKey, val);\n    }\n\n    /**\n     * @dev we are essentially claiming this [id].[table] for the msg.sender, and setting the id createdDate\n     */\n    function _setRowOwner(bytes32 idTableKey, bytes32 id, bytes32 tableKey) internal {\n\n        require(database.containsKey(idTableKey) == false, \"row already has owner\");\n\n        uint256 rowMetadata = uint256(uint32(now));\n\n        rowMetadata |= uint256(_msgSender())<<32;\n\n        database.setValueForKey(idTableKey, bytes32(rowMetadata));\n    }\n\n    /**\n     * Primarily to assist querying all ids belonging to an owner\n     */\n    /*\n    event InsertRow (\n        bytes32 indexed _id,\n        bytes32 indexed _tableKey,\n        address indexed _rowOwner\n    );\n    */\n\n    function getRowOwner(bytes32 idTableKey) external returns (address rowOwner, bytes4 createdDate){\n\n        uint256 rowMetadata = uint256(database.getBytes32ForKey(idTableKey));\n\n        createdDate = bytes4(uint32(rowMetadata));\n        rowOwner = address(rowMetadata>>32);\n\n    }\n\n    function updateCheck(bytes32 tableKey, bytes32 idKey, bytes32 idTableKey, bytes32 id) internal {\n\n        require(tableId.containsValueForKey(tableKey, id) == true, \"id doesn't exist, use INSERT\");\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot UPDATE system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can UPDATE into this table\");\n\n        // permissions check (public table = 2, shared table = 3),\n        // if 2 or 3 is the _msg.sender() the row owner? But if 3 owner() is always allowed\n        if (permission >= 2) {\n\n            // rowMetaData is packed as address (bytes20) + createdDate (bytes4)\n            bytes32 rowMetaData = database.getBytes32ForKey(idTableKey);\n            address rowOwner = address(uint256(rowMetaData)>>32);\n\n            // if either 2 or 3, if you're the row owner it's fine\n            if (rowOwner == _msgSender()){\n                // pass\n            } else {\n                require(isOwner() == true || delegate == _msgSender(), \"Not rowOwner or owner/delegate for UPDATE into this table\");\n            }\n        }\n    }\n\n    function updateVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes32 val)\n\n    public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        updateCheck(tableKey, idKey, idTableKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // set data (overwrite)\n        database.setValueForKey(fieldIdTableKey, bytes32(val));\n\n        // emit an event to assist in queries\n        emit InsertVal(tableKey, fieldKey, val, id, _msgSender());\n    }\n\n    function deleteCheck(bytes32 tableKey, bytes32 idTableKey, bytes32 idKey, bytes32 id) internal {\n\n        require(tableId.containsValueForKey(tableKey, id) == true, \"id doesn't exist\");\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot DELETE from system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can DELETE from this table\");\n\n        // permissions check (public table = 2, shared table = 3),\n        // if 2 or 3 is the _msg.sender() the row owner? But if 3 owner() is always allowed\n        if (permission >= 2) {\n            if (isOwner() || delegate == _msgSender()){\n                // pass\n            } else {\n                // rowMetaData is packed as address (bytes20) + createdDate (bytes4)\n                bytes32 rowMetaData = database.getBytes32ForKey(idTableKey);\n                address rowOwner = address(uint256(rowMetaData)>>32);\n                require(rowOwner == _msgSender(), \"Sender not owner of row\");\n            }\n        }\n    }\n\n    /**\n     * @dev TODO: add modifier checks based on update\n     *\n     * TODO: this needs to properly remove the row when there are multiple ids\n     *\n     */\n    function deleteVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id\n\n    ) public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        deleteCheck(tableKey, idTableKey, idKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // remove the key\n        bool removed = database.removeKey(fieldIdTableKey);\n\n        require(removed == true, \"error removing key\");\n\n        // TODO: zero out the data? Why bother everything is public\n\n        // we can't really pass in enough data to make a loop worthwhile\n        /*\n        uint8 len = uint8(fieldKeys.length);\n        require(fieldKeys.length == fieldIdTableKeys.length, \"fields, id array length mismatch\");\n        for (uint8 i = 0; i < len; i++) {\n\n            // for each row check if the full field + id + table is a subhash\n            // require(isNamehashSubOf(fieldKeys[i], idTableKey, fieldIdTableKeys[i]) == true, \"fieldKey not a subhash [field].[id].[table]\");\n\n            // zero out the data\n            elajsStore[fieldIdTableKeys[i]] = bytes32(0);\n        }\n        */\n    }\n\n    // TODO: improve this, we don't want to cause data consistency if the client doesn't call this\n    // Right now we manually call this, but ideally we iterate over all the data and delete each column\n    // but this would require decoding and having all the field names\n    function deleteRow(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 id\n\n    ) public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n\n        deleteCheck(tableKey, idTableKey, idKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // remove the id\n        tableId.removeValueForKey(tableKey, id);\n    }\n\n    /**\n     * @dev Table actual insert call, NOTE this doesn't work on testnet currently due to a stack size issue,\n     *      but it can work with a paid transaction I guess\n     */\n    /*\n    function insert(\n        bytes32 tableKey,\n        bytes32 idTableKey,\n\n        bytes32 idKey,\n        bytes32 id,\n\n        bytes32[] memory fieldKeys,\n        bytes32[] memory fieldIdTableKeys,\n        bytes32[] memory values)\n\n    public insertCheck(tableKey, idKey, idTableKey){\n\n        require(table.containsValueForKey(tableKey, id) == false, \"id already exists\");\n\n        uint len = fieldKeys.length;\n\n        require(fieldKeys.length == fieldIdTableKeys.length == values.length, \"fields, values array length mismatch\");\n\n        // add an id entry to the table's set of ids for the row\n        table.addValueForKey(tableKey, id);\n\n        for (uint i = 0; i < len; i++) {\n\n            // for each row check if the full field + id + table is a subhash\n            require(isNamehashSubOf(fieldKeys[i], idTableKey, fieldIdTableKeys[i]) == true, \"fieldKey not a subhash [field].[id].[table]\");\n\n            elajsStore[fieldIdTableKeys[i]] = bytes32(values[i]);\n        }\n\n    }\n    */\n\n    /*\n    function getAllDataKeys() external view returns (bytes32[] memory) {\n        return database.enumerate();\n    }\n    */\n\n    function checkDataKey(bytes32 key) external view returns (bool) {\n        return database.containsKey(key);\n    }\n\n    /**\n     * @dev all data is public, so no need for security checks, we leave the data type handling to the client\n     */\n    function getRowValue(bytes32 fieldIdTableKey) external view returns (bytes32) {\n\n        if (database.containsKey(fieldIdTableKey)) {\n            return database.getBytes32ForKey(fieldIdTableKey);\n        } else {\n            return bytes32(0);\n        }\n    }\n\n    function getRowValueVar(bytes32 fieldIdTableKey) external view returns (bytes memory) {\n\n        if (database.containsKey(fieldIdTableKey)) {\n            return database.getBytesForKey(fieldIdTableKey);\n        } else {\n            return new bytes(0);\n        }\n    }\n\n    /**\n     * @dev Warning this produces an Error: overflow (operation=\"setValue\", fault=\"overflow\", details=\"Number can only safely store up to 53 bits\")\n     *      if the table doesn't exist\n     */\n    function getTableIds(bytes32 tableKey) external view returns (bytes32[] memory){\n\n        require(tableId.containsKey(tableKey) == true, \"table not created\");\n\n        return tableId.enumerateForKey(tableKey);\n    }\n\n    function getIdExists(bytes32 tableKey, bytes32 id) external view returns (bool) {\n        return tableId.containsValueForKey(tableKey, id);\n    }\n\n    /*\n    function isNamehashSubOf(bytes32 subKey, bytes32 base, bytes32 target) internal pure returns (bool) {\n        bytes32 result = namehash(subKey, base);\n        return result == target;\n    }\n    */\n\n    function namehash(bytes32 subKey, bytes32 base) internal pure returns (bytes32) {\n        bytes memory concat = new bytes(64);\n\n        assembly {\n            mstore(add(concat, 64), subKey)\n            mstore(add(concat, 32), base)\n        }\n\n        bytes32 result = keccak256(concat);\n\n        return result;\n    }\n\n    // ************************************* _TABLE FUNCTIONS *************************************\n    function getTableMetadata(bytes32 _tableKey)\n        view\n        public\n        returns (uint256 permission, address delegate)\n    {\n        require(_table[_tableKey] > 0, \"table does not exist\");\n\n        uint256 tableMetadata = uint256(_table[_tableKey]);\n\n        permission = uint256(uint8(tableMetadata));\n        delegate = address(tableMetadata>>8);\n    }\n\n    // TODO: we want to add the schema updated time here, then we can have a reliable schema cache\n    function setTableMetadata(bytes32 _tableKey, uint8 permission, address delegate) private onlyOwner {\n        uint256 tableMetadata;\n\n        tableMetadata |= permission;\n        tableMetadata |= uint160(delegate)<<8;\n\n        _table[_tableKey] = bytes32(tableMetadata);\n    }\n\n    // ************************************* MISC FUNCTIONS *************************************\n\n    function() external payable {}\n\n    // ************************************* GSN FUNCTIONS *************************************\n    /*\n    event AcceptRelayCall (\n        uint256 curCounter,\n        uint40 gsnMaxCallsPerDay\n    );\n    */\n\n    /**\n     * As a first layer of defense we employ a max number of checks per day\n     */\n    function acceptRelayedCall(\n        address relay,\n        address from,\n        bytes calldata encodedFunction,\n        uint256 transactionFee,\n        uint256 gasPrice,\n        uint256 gasLimit,\n        uint256 nonce,\n        bytes calldata approvalData,\n        uint256 maxPossibleCharge\n    ) external view returns (uint256, bytes memory) {\n\n        uint256 curDay = getCurDay();\n        uint256 curCounter = gsnCounter[curDay];\n\n        if (curCounter >= gsnMaxCallsPerDay){\n            return _rejectRelayedCall(11);\n        }\n\n        return _approveRelayedCall();\n    }\n\n    function setGsnMaxCallsPerDay(uint256 max) external onlyOwner {\n        gsnMaxCallsPerDay = uint40(max);\n    }\n\n    /*\n    event GsnCounterIncrease (\n        address indexed _from,\n        bytes4 indexed curDate\n    );\n    */\n\n    /**\n     * Increase the GSN Counter for today\n     */\n    function increaseGsnCounter() internal {\n\n        uint256 curDay = getCurDay();\n        uint256 curCounter = gsnCounter[curDay];\n\n        gsnCounter[curDay] = curCounter + 1;\n\n        // emit GsnCounterIncrease(_msgSender(), bytes4(uint32(curDate)));\n    }\n\n    /*\n     *\n     */\n    function getCurDay() public view returns (uint256) {\n        return uint256(uint(now) / uint(DAY_IN_SECONDS));\n    }\n\n    // We won't do any pre or post processing, so leave _preRelayedCall and _postRelayedCall empty\n    function _preRelayedCall(bytes memory context) internal returns (bytes32) {\n    }\n\n    function _postRelayedCall(bytes memory context, bool, uint256 actualCharge, bytes32) internal {\n    }\n\n    /**\n     * @dev Withdraw a specific amount of the GSNReceipient funds\n     * @param amt Amount of wei to withdraw\n     * @param dest This is the arbitrary withdrawal destination address\n     */\n    function withdraw(uint256 amt, address payable dest) public onlyOwner {\n        IRelayHubELA relayHub = getRelayHub();\n        relayHub.withdraw(amt, dest);\n    }\n\n    /**\n     * @dev Withdraw all the GSNReceipient funds\n     * @param dest This is the arbitrary withdrawal destination address\n     */\n    function withdrawAll(address payable dest) public onlyOwner returns (uint256) {\n        IRelayHubELA relayHub = getRelayHub();\n        uint256 balance = getRelayHub().balanceOf(address(this));\n        relayHub.withdraw(balance, dest);\n        return balance;\n    }\n\n    function getGSNBalance() public view returns (uint256) {\n        return getRelayHub().balanceOf(address(this));\n    }\n\n    function getRelayHub() internal view returns (IRelayHubELA) {\n        return IRelayHubELA(_getRelayHub());\n    }\n}\n";
var sourcePath = "contracts/ELAJSStore.sol";
var sourceMap = "640:21774:1:-;;;;;;;;;";
var deployedSourceMap = "640:21774:1:-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;20989:116;;8:9:-1;5:2;;;30:1;27;20:12;5:2;20989:116:1;;;;;;;;;;;;;;;;;;;;21602:162;;8:9:-1;5:2;;;30:1;27;20:12;5:2;21602:162:1;;;;;;;;;;;;;;;;;;;1198:31;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1198:31:1;;;;;;;;;;;;;;;;;;;;16657:113;;8:9:-1;5:2;;;30:1;27;20:12;5:2;16657:113:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;4760:138;;8:9:-1;5:2;;;30:1;27;20:12;5:2;4760:138:1;;;;;;;;;;;;;;;;;;;;9882:280;;8:9:-1;5:2;;;30:1;27;20:12;5:2;9882:280:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;3520:962;;8:9:-1;5:2;;;30:1;27;20:12;5:2;3520:962:1;;;;;;;;;;;;;;;;;;;22177:117;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22177:117:1;;;;;;;;;;;;;;;;;;;;8284:891;;8:9:-1;5:2;;;30:1;27;20:12;5:2;8284:891:1;;;;;;;;;;;;;;;;;;;2173:106;;8:9:-1;5:2;;;30:1;27;20:12;5:2;2173:106:1;;;;;;;;;;;;;;;;;;;;16902:260;;8:9:-1;5:2;;;30:1;27;20:12;5:2;16902:260:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;1724:137:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1724:137:15;;;;;;621:90:6;;8:9:-1;5:2;;;30:1;27;20:12;5:2;621:90:6;;;;;;;;;;;;;;;;;;;;5043:518:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;5043:518:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;11501:606;;8:9:-1;5:2;;;30:1;27;20:12;5:2;11501:606:1;;;;;;;;;;;;;;;;;;;945:210:9;;8:9:-1;5:2;;;30:1;27;20:12;5:2;945:210:9;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;14975:357:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;14975:357:1;;;;;;;;;;;;;;;;;;;19833:577;;8:9:-1;5:2;;;30:1;27;20:12;5:2;19833:577:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;13503:1193;;8:9:-1;5:2;;;30:1;27;20:12;5:2;13503:1193:1;;;;;;;;;;;;;;;;;;;937:77:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;937:77:15;;;;;;;;;;;;;;;;;;;;1288:92;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1288:92:15;;;;;;;;;;;;;;;;;;;;5587:186:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;5587:186:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;1094:45;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1094:45:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;825:227:6;;8:9:-1;5:2;;;30:1;27;20:12;5:2;825:227:6;;;;;;;;;;;;;;;;;;;;7092:1186:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;7092:1186:1;;;;;;;;;;;;;;;;;;;20416:110;;8:9:-1;5:2;;;30:1;27;20:12;5:2;20416:110:1;;;;;;;;;;;;;;;;;;;17645:215;;8:9:-1;5:2;;;30:1;27;20:12;5:2;17645:215:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;2725:184;;8:9:-1;5:2;;;30:1;27;20:12;5:2;2725:184:1;;;;;;;;;;;;;;;;;;;18649:363;;8:9:-1;5:2;;;30:1;27;20:12;5:2;18649:363:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;1412:276:9;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1412:276:9;;;;;;;;;;;;;;;;;;;17168:268:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;17168:268:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;4521:233;;8:9:-1;5:2;;;30:1;27;20:12;5:2;4521:233:1;;;;;;;;;;;;;;;;;;;17866:145;;8:9:-1;5:2;;;30:1;27;20:12;5:2;17866:145:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;2010:107:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;2010:107:15;;;;;;;;;;;;;;;;;;;21907:264:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;21907:264:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;20989:116;21031:7;729:5;21070:3;21065:32;;;;;;;;21050:48;;20989:116;:::o;21602:162::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;21682:21:1;21706:13;:11;:13::i;:::-;21682:37;;21729:8;:17;;;21747:3;21752:4;21729:28;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;21729:28:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;21729:28:1;;;;1197:1:15;21602:162:1;;:::o;1198:31::-;;;;;;;;;;;;;:::o;16657:113::-;16715:4;16738:25;16759:3;16738:8;:20;;:25;;;;:::i;:::-;16731:32;;16657:113;;;:::o;4760:138::-;4804:16;4838:53;2213:66;4877:13;;4838:8;:38;;:53;;;;:::i;:::-;4831:60;;4760:138;:::o;9882:280::-;9941:16;9959:18;9989:19;10019:37;10045:10;10019:8;:25;;:37;;;;:::i;:::-;10011:46;;;9989:68;;10096:11;10082:27;;10068:41;;10151:2;10138:11;:15;52:12:-1;49:1;45:20;29:14;25:41;7:59;;10138:15:1;10119:35;;9882:280;;;;:::o;3520:962::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;4033:1:1;4013:21;;:6;:16;4020:8;4013:16;;;;;;;;;;;;:21;4005:54;;;;;;;;;;;;;;;;;;;;;;;;4070:16;4097:3;4070:31;;4163:48;4180:8;4190:10;4202:8;4163:16;:48::i;:::-;4222:49;2213:66;4246:13;;4261:9;4222:8;:23;;:49;;;;;:::i;:::-;;4351:24;4366:8;4351:7;:14;;:24;;;;:::i;:::-;;4419:56;4430:9;4441:8;4451:10;4463:11;4419:10;:56::i;:::-;;1197:1:15;3520:962:1;;;;;:::o;22177:117::-;22223:7;22249:13;:11;:13::i;:::-;:23;;;22281:4;22249:38;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22249:38:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22249:38:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;22249:38:1;;;;;;;;;22242:45;;22177:117;:::o;8284:891::-;8453:8;5987:18;6007:16;6027:26;6044:8;6027:16;:26::i;:::-;5986:67;;;;6149:1;6136:10;:14;6128:58;;;;;;;;;;;;;;;;;;;;;;;;6278:1;6265:10;:14;:35;;;;6296:4;6283:17;;:9;:7;:9::i;:::-;:17;;;6265:35;:63;;;;6316:12;:10;:12::i;:::-;6304:24;;:8;:24;;;6265:63;6257:122;;;;;;;;;;;;;;;;;;;;;;;;8473:18;8494:25;8503:5;8510:8;8494;:25::i;:::-;8473:46;;8529:23;8555:30;8564:8;8574:10;8555:8;:30::i;:::-;8529:56;;8645:5;8604:46;;:37;8625:15;8604:8;:20;;:37;;;;:::i;:::-;:46;;;8596:82;;;;;;;;;;;;;;;;;;;;;;;;8718:20;:18;:20::i;:::-;8814:36;8837:8;8847:2;8814:7;:22;;:36;;;;;:::i;:::-;;9012:5;8976:41;;:32;8997:10;8976:8;:20;;:32;;;;:::i;:::-;:41;;;8972:109;;;9032:38;9045:10;9057:2;9061:8;9032:12;:38::i;:::-;8972:109;9123:45;9147:15;9164:3;9123:8;:23;;:45;;;;;:::i;:::-;;6390:1;;8284:891;;;;;;;;:::o;2173:106::-;2213:66;2173:106;;;:::o;16902:260::-;16971:7;16995:37;17016:15;16995:8;:20;;:37;;;;:::i;:::-;16991:165;;;17055:42;17081:15;17055:8;:25;;:42;;;;:::i;:::-;17048:49;;;;16991:165;17143:1;17135:10;;17128:17;;16902:260;;;;:::o;1724:137:15:-;1141:9;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;1822:1;1785:40;;1806:6;;;;;;;;;;;1785:40;;;;;;;;;;;;1852:1;1835:6;;:19;;;;;;;;;;;;;;;;;;1724:137::o;621:90:6:-;664:7;690:14;:12;:14::i;:::-;683:21;;621:90;:::o;5043:518:1:-;5224:4;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;5241:33:1;;:::i;:::-;5277:97;5306:9;5329:10;5353:11;5277:15;:97::i;:::-;5241:133;;5385:20;5408;:11;:18;:20::i;:::-;5385:43;;5512:42;5536:8;5546:7;5512:8;:23;;:42;;;;;:::i;:::-;5505:49;;;;5043:518;;;;;;:::o;11501:606::-;11662:18;11683:25;11692:5;11699:8;11683;:25::i;:::-;11662:46;;11718:23;11744:30;11753:8;11763:10;11744:8;:30::i;:::-;11718:56;;11785:44;11797:8;11807:5;11814:10;11826:2;11785:11;:44::i;:::-;11869:20;:18;:20::i;:::-;11932:54;11956:15;11981:3;11932:8;:23;;:54;;;;;:::i;:::-;;12078:3;12068:8;12058;12048:52;12083:2;12087:12;:10;:12::i;:::-;12048:52;;;;;;;;;;;;;;;;11501:606;;;;;;;:::o;945:210:9:-;1011:7;1052:12;:10;:12::i;:::-;1038:26;;:10;:26;;;1030:77;;;;;;;;;;;;;;;;;;;;;;;;1124:24;1140:7;;1124:24;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;1124:24:9;;;;;;:15;:24::i;:::-;1117:31;;945:210;;;;:::o;14975:357:1:-;15089:18;15110:25;15119:5;15126:8;15110;:25::i;:::-;15089:46;;15146:44;15158:8;15168:10;15180:5;15187:2;15146:11;:44::i;:::-;15230:20;:18;:20::i;:::-;15286:39;15312:8;15322:2;15286:7;:25;;:39;;;;;:::i;:::-;;14975:357;;;;:::o;19833:577::-;20153:7;20162:12;20187:14;20204:11;:9;:11::i;:::-;20187:28;;20225:18;20246:10;:18;20257:6;20246:18;;;;;;;;;;;;20225:39;;20293:17;;;;;;;;;;;20279:31;;:10;:31;;20275:90;;;20332:22;20351:2;20332:18;:22::i;:::-;20325:29;;;;;;;;20275:90;20382:21;:19;:21::i;:::-;20375:28;;;;;;19833:577;;;;;;;;;;;;;;;:::o;13503:1193::-;13644:18;13665:25;13674:5;13681:8;13665;:25::i;:::-;13644:46;;13700:23;13726:30;13735:8;13745:10;13726:8;:30::i;:::-;13700:56;;13767:44;13779:8;13789:10;13801:5;13808:2;13767:11;:44::i;:::-;13851:20;:18;:20::i;:::-;13908:12;13923:35;13942:15;13923:8;:18;;:35;;;;:::i;:::-;13908:50;;13988:4;13977:15;;:7;:15;;;13969:46;;;;;;;;;;;;;;;;;;;;;;;;13503:1193;;;;;;;:::o;937:77:15:-;975:7;1001:6;;;;;;;;;;;994:13;;937:77;:::o;1288:92::-;1328:4;1367:6;;;;;;;;;;;1351:22;;:12;:10;:12::i;:::-;:22;;;1344:29;;1288:92;:::o;5587:186:1:-;5642:21;;:::i;:::-;5675:20;5698:30;5722:5;5698:8;:23;;:30;;;;:::i;:::-;5675:53;;5745:21;:7;:19;:21::i;:::-;5738:28;;;5587:186;;;:::o;1094:45::-;;;;;;;;;;;;;;;;;:::o;825:227:6:-;873:13;1031:14;;;;;;;;;;;;;;;;;;;;825:227;:::o;7092:1186:1:-;7254:8;5987:18;6007:16;6027:26;6044:8;6027:16;:26::i;:::-;5986:67;;;;6149:1;6136:10;:14;6128:58;;;;;;;;;;;;;;;;;;;;;;;;6278:1;6265:10;:14;:35;;;;6296:4;6283:17;;:9;:7;:9::i;:::-;:17;;;6265:35;:63;;;;6316:12;:10;:12::i;:::-;6304:24;;:8;:24;;;6265:63;6257:122;;;;;;;;;;;;;;;;;;;;;;;;7274:18;7295:25;7304:5;7311:8;7295;:25::i;:::-;7274:46;;7330:23;7356:30;7365:8;7375:10;7356:8;:30::i;:::-;7330:56;;7446:5;7405:46;;:37;7426:15;7405:8;:20;;:37;;;;:::i;:::-;:46;;;7397:82;;;;;;;;;;;;;;;;;;;;;;;;7519:20;:18;:20::i;:::-;7718:36;7741:8;7751:2;7718:7;:22;;:36;;;;;:::i;:::-;;7916:5;7880:41;;:32;7901:10;7880:8;:20;;:32;;;;:::i;:::-;:41;;;7876:109;;;7936:38;7949:10;7961:2;7965:8;7936:12;:38::i;:::-;7876:109;8102:54;8126:15;8151:3;8102:8;:23;;:54;;;;;:::i;:::-;;8248:3;8238:8;8228;8218:52;8253:2;8257:12;:10;:12::i;:::-;8218:52;;;;;;;;;;;;;;;;6390:1;;7092:1186;;;;;;;;:::o;20416:110::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;20515:3:1;20488:17;;:31;;;;;;;;;;;;;;;;;;20416:110;:::o;17645:215::-;17707:16;17776:4;17743:37;;:29;17763:8;17743:7;:19;;:29;;;;:::i;:::-;:37;;;17735:67;;;;;;;;;;;;;;;;;;;;;;;;17820:33;17844:8;17820:7;:23;;:33;;;;:::i;:::-;17813:40;;17645:215;;;:::o;2725:184::-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;2796:33:1;2818:10;2796:21;:33::i;:::-;2839:40;2866:12;2839:26;:40::i;:::-;2889:13;:11;:13::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;2725:184:1;;:::o;18649:363::-;18739:18;18759:16;18819:1;18799:21;;:6;:17;18806:9;18799:17;;;;;;;;;;;;:21;18791:54;;;;;;;;;;;;;;;;;;;;;;;;18856:21;18888:6;:17;18895:9;18888:17;;;;;;;;;;;;18880:26;;;18856:50;;18944:13;18930:29;;18917:42;;19003:1;18988:13;:16;52:12:-1;49:1;45:20;29:14;25:41;7:59;;18988:16:1;18969:36;;18649:363;;;;:::o;1412:276:9:-;1557:12;:10;:12::i;:::-;1543:26;;:10;:26;;;1535:77;;;;;;;;;;;;;;;;;;;;;;;;1622:59;1639:7;;1622:59;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;1622:59:9;;;;;;1648:7;1657:12;1671:9;1622:16;:59::i;:::-;1412:276;;;;;:::o;17168:268:1:-;17240:12;17269:37;17290:15;17269:8;:20;;:37;;;;:::i;:::-;17265:165;;;17329:40;17353:15;17329:8;:23;;:40;;;;:::i;:::-;17322:47;;;;17265:165;17417:1;17407:12;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;17407:12:1;;;;17400:19;;17168:268;;;;:::o;4521:233::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;4647:1:1;4628:20;;:6;:16;4635:8;4628:16;;;;;;;;;;;:20;;;;4658:52;2213:66;4685:13;;4700:9;4658:8;:26;;:52;;;;;:::i;:::-;;4720:27;4738:8;4720:7;:17;;:27;;;;:::i;:::-;;4521:233;;:::o;17866:145::-;17940:4;17963:41;17991:8;18001:2;17963:7;:27;;:41;;;;;:::i;:::-;17956:48;;17866:145;;;;:::o;2010:107:15:-;1141:9;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;2082:28;2101:8;2082:18;:28::i;:::-;2010:107;:::o;21907:264:1:-;21976:7;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;21995:21:1;22019:13;:11;:13::i;:::-;21995:37;;22042:15;22060:13;:11;:13::i;:::-;:23;;;22092:4;22060:38;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22060:38:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22060:38:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;22060:38:1;;;;;;;;;22042:56;;22108:8;:17;;;22126:7;22135:4;22108:32;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22108:32:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22108:32:1;;;;22157:7;22150:14;;;;21907:264;;;:::o;22300:112::-;22346:12;22390:14;:12;:14::i;:::-;22370:35;;22300:112;:::o;5682:394:24:-;5806:4;5845:42;5882:4;5845:10;:24;;:36;;:42;;;;:::i;:::-;:103;;;;5903:45;5943:4;5903:10;:27;;:39;;:45;;;;:::i;:::-;5845:103;:162;;;;5964:43;6002:4;5964:10;:25;;:37;;:43;;;;:::i;:::-;5845:162;:224;;;;6023:46;6064:4;6023:10;:28;;:40;;:46;;;;:::i;:::-;5845:224;5826:243;;5682:394;;;;:::o;4706:229::-;4846:16;4881:47;4923:4;4881:10;:25;;:41;;:47;;;;:::i;:::-;4874:54;;4706:229;;;;:::o;9510:203::-;9636:7;9662:44;9702:3;9662:10;:24;;:39;;:44;;;;:::i;:::-;9655:51;;9510:203;;;;:::o;19117:275:1:-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;19226:21:1;19275:10;19258:27;;;;;;19331:1;19320:8;19312:20;;;;;;19295:37;;;;;;19371:13;19363:22;;19343:6;:17;19350:9;19343:17;;;;;;;;;;;:42;;;;1197:1:15;19117:275:1;;;:::o;20565:632:24:-;20709:4;20747:42;20784:4;20747:10;:24;;:36;;:42;;;;:::i;:::-;20746:43;20725:122;;;;;;;;;;;;;;;;;;;;;;;;20879:45;20919:4;20879:10;:27;;:39;;:45;;;;:::i;:::-;20878:46;20857:125;;;;;;;;;;;;;;;;;;;;;;;;21014:46;21055:4;21014:10;:28;;:40;;:46;;;;:::i;:::-;21013:47;20992:126;;;;;;;;;;;;;;;;;;;;;;;;21136:54;21177:4;21183:6;21136:10;:25;;:40;;:54;;;;;:::i;:::-;21129:61;;20565:632;;;;;:::o;818:168:19:-;925:4;952:27;975:3;952:13;:18;;:22;;:27;;;;:::i;:::-;945:34;;818:168;;;;:::o;2244:207:5:-;2289:7;2326:14;:12;:14::i;:::-;2312:28;;:10;:28;;;;2308:137;;;2363:10;2356:17;;;;2308:137;2411:23;:21;:23::i;:::-;2404:30;;2244:207;;:::o;18226:317:1:-;18297:7;18316:19;18348:2;18338:13;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;18338:13:1;;;;18316:35;;18409:6;18404:2;18396:6;18392:15;18385:31;18453:4;18448:2;18440:6;18436:15;18429:29;18478:14;18505:6;18495:17;;;;;;18478:34;;18530:6;18523:13;;;;18226:317;;;;:::o;20705:256::-;20755:14;20772:11;:9;:11::i;:::-;20755:28;;20793:18;20814:10;:18;20825:6;20814:18;;;;;;;;;;;;20793:39;;20877:1;20864:10;:14;20843:10;:18;20854:6;20843:18;;;;;;;;;;;:35;;;;20705:256;;:::o;2339:312:19:-;2483:4;2503:31;2515:13;2530:3;2503:11;:31::i;:::-;2499:146;;;2557:34;2585:5;2557:13;:18;;:23;2576:3;2557:23;;;;;;;;;;;:27;;:34;;;;:::i;:::-;2550:41;;;;2499:146;2629:5;2622:12;;2339:312;;;;;;:::o;9306:346:1:-;9442:5;9406:41;;:32;9427:10;9406:8;:20;;:32;;;;:::i;:::-;:41;;;9398:75;;;;;;;;;;;;;;;;;;;;;;;;9484:19;9521:3;9506:20;;9484:42;;9575:2;9560:12;:10;:12::i;:::-;9552:21;;:25;;;;9537:40;;;;9588:57;9612:10;9632:11;9624:20;;9588:8;:23;;:57;;;;;:::i;:::-;;9306:346;;;;:::o;19584:637:24:-;19733:4;19771:42;19808:4;19771:10;:24;;:36;;:42;;;;:::i;:::-;19770:43;19749:122;;;;;;;;;;;;;;;;;;;;;;;;19903:43;19941:4;19903:10;:25;;:37;;:43;;;;:::i;:::-;19902:44;19881:123;;;;;;;;;;;;;;;;;;;;;;;;20036:46;20077:4;20036:10;:28;;:40;;:46;;;;:::i;:::-;20035:47;20014:126;;;;;;;;;;;;;;;;;;;;;;;;20158:56;20201:4;20207:6;20158:10;:27;;:42;;:56;;;;;:::i;:::-;20151:63;;19584:637;;;;;:::o;1173:248:5:-;1220:16;1248:12;754:66;1263:30;;1248:45;;1400:4;1394:11;1382:23;;1368:47;;:::o;1327:396:29:-;1472:12;;:::i;:::-;1526;:19;1504:11;:18;:41;1496:70;;;;;;;;;;;;;;;;;;;;;;;;1576:18;;:::i;:::-;1617:5;1604;:10;;:18;;;;;1648:46;1669:11;1681:12;1648:20;:46::i;:::-;1632:5;:13;;:62;;;;1711:5;1704:12;;;1327:396;;;;;:::o;1780:424::-;1839:12;1863:14;1880:11;1885:5;1880:4;:11::i;:::-;1863:28;;1901:17;1931:6;1921:17;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;1921:17:29;;;;1901:37;;1963:38;1988:6;1996:4;1963:5;:10;;;:24;;:38;;;;;:::i;:::-;2054:2;2044:12;;;;2075:38;2100:6;2108:4;2075:5;:13;;;:24;;:38;;;;;:::i;:::-;2066:47;;2142:1;2132:6;:11;2124:52;;;;;;;;;;;;;;;;;;;;;;;;2193:4;2186:11;;;;1780:424;;;:::o;10168:1327:1:-;10327:4;10282:49;;:41;10310:8;10320:2;10282:7;:27;;:41;;;;;:::i;:::-;:49;;;10274:90;;;;;;;;;;;;;;;;;;;;;;;;10376:18;10396:16;10416:26;10433:8;10416:16;:26::i;:::-;10375:67;;;;10538:1;10525:10;:14;10517:53;;;;;;;;;;;;;;;;;;;;;;;;10662:1;10649:10;:14;:35;;;;10680:4;10667:17;;:9;:7;:9::i;:::-;:17;;;10649:35;:63;;;;10700:12;:10;:12::i;:::-;10688:24;;:8;:24;;;10649:63;10641:122;;;;;;;;;;;;;;;;;;;;;;;;10951:1;10937:10;:15;;10933:556;;;11050:19;11072:37;11098:10;11072:8;:25;;:37;;;;:::i;:::-;11050:59;;11123:16;11172:2;11158:11;11150:20;;;:24;52:12:-1;49:1;45:20;29:14;25:41;7:59;;11150:24:1;11123:52;;11273:12;:10;:12::i;:::-;11261:24;;:8;:24;;;11257:222;;;;;;11370:4;11357:17;;:9;:7;:9::i;:::-;:17;;;:45;;;;11390:12;:10;:12::i;:::-;11378:24;;:8;:24;;;11357:45;11349:115;;;;;;;;;;;;;;;;;;;;;;;;11257:222;10933:556;;;10168:1327;;;;;;:::o;16647:632:24:-;16791:4;16829:45;16869:4;16829:10;:27;;:39;;:45;;;;:::i;:::-;16828:46;16807:125;;;;;;;;;;;;;;;;;;;;;;;;16964:43;17002:4;16964:10;:25;;:37;;:43;;;;:::i;:::-;16963:44;16942:123;;;;;;;;;;;;;;;;;;;;;;;;17097:46;17138:4;17097:10;:28;;:40;;:46;;;;:::i;:::-;17096:47;17075:126;;;;;;;;;;;;;;;;;;;;;;;;17219:53;17259:4;17265:6;17219:10;:24;;:39;;:53;;;;;:::i;:::-;17212:60;;16647:632;;;;;:::o;21210:81:1:-;21275:7;21210:81;;;:::o;12113:1221::-;12272:4;12227:49;;:41;12255:8;12265:2;12227:7;:27;;:41;;;;;:::i;:::-;:49;;;12219:78;;;;;;;;;;;;;;;;;;;;;;;;12309:18;12329:16;12349:26;12366:8;12349:16;:26::i;:::-;12308:67;;;;12471:1;12458:10;:14;12450:58;;;;;;;;;;;;;;;;;;;;;;;;12600:1;12587:10;:14;:35;;;;12618:4;12605:17;;:9;:7;:9::i;:::-;:17;;;12587:35;:63;;;;12638:12;:10;:12::i;:::-;12626:24;;:8;:24;;;12587:63;12579:122;;;;;;;;;;;;;;;;;;;;;;;;12889:1;12875:10;:15;;12871:457;;;12910:9;:7;:9::i;:::-;:37;;;;12935:12;:10;:12::i;:::-;12923:24;;:8;:24;;;12910:37;12906:412;;;;;;13096:19;13118:37;13144:10;13118:8;:25;;:37;;;;:::i;:::-;13096:59;;13173:16;13222:2;13208:11;13200:20;;;:24;52:12:-1;49:1;45:20;29:14;25:41;7:59;;13200:24:1;13173:52;;13263:12;:10;:12::i;:::-;13251:24;;:8;:24;;;13243:60;;;;;;;;;;;;;;;;;;;;;;;;12906:412;;;12871:457;12113:1221;;;;;;:::o;3131:318:19:-;3278:4;3298:31;3310:13;3325:3;3298:11;:31::i;:::-;3294:149;;;3352:37;3383:5;3352:13;:18;;:23;3371:3;3352:23;;;;;;;;;;;:30;;:37;;;;:::i;:::-;3345:44;;;;3294:149;3427:5;3420:12;;3131:318;;;;;;:::o;2441:156:9:-;2511:7;2520:12;2576:9;427:2;2552:33;2544:46;;;;;;;;;;;;;;;;;2441:156;;;:::o;1869:124::-;1923:7;1932:12;1963:23;;;;;;;;;;;;;;:19;:23::i;:::-;1956:30;;;;1869:124;;:::o;26241:371:24:-;26350:4;26389:40;26424:4;26389:10;:24;;:34;;:40;;;;:::i;:::-;:99;;;;26445:43;26483:4;26445:10;:27;;:37;;:43;;;;:::i;:::-;26389:99;:156;;;;26504:41;26540:4;26504:10;:25;;:35;;:41;;;;:::i;:::-;26389:156;:216;;;;26561:44;26600:4;26561:10;:28;;:38;;:44;;;;:::i;:::-;26389:216;26370:235;;26241:371;;;;:::o;11579:209::-;11703:12;11734:47;11777:3;11734:10;:27;;:42;;:47;;;;:::i;:::-;11727:54;;11579:209;;;;:::o;2286:403:29:-;2375:12;;:::i;:::-;2403:14;2420:6;:13;2403:30;;2443:18;;:::i;:::-;2484:24;2501:6;2484;:16;;:24;;;;:::i;:::-;2471:5;:10;;:37;;;;;2528:2;2518:12;;;;2566:31;2590:6;2566;:23;;:31;;;;:::i;:::-;2540:57;;;2541:5;:13;;2540:57;;;;;;;;2626:1;2616:6;:11;2608:52;;;;;;;;;;;;;;;;;;;;;;;;2677:5;2670:12;;;;2286:403;;;:::o;992:185:19:-;1115:4;1138:32;1166:3;1138:13;:18;;:27;;:32;;;;:::i;:::-;1131:39;;992:185;;;;:::o;4160:319::-;4287:16;4319:31;4331:13;4346:3;4319:11;:31::i;:::-;4315:158;;;4373:35;:13;:18;;:23;4392:3;4373:23;;;;;;;;;;;:33;:35::i;:::-;4366:42;;;;4315:158;4460:1;4446:16;;;;;;;;;;;;;;;;;;;;;;29:2:-1;21:6;17:15;117:4;105:10;97:6;88:34;148:4;140:6;136:17;126:27;;0:157;4446:16:19;;;;4439:23;;4160:319;;;;;:::o;1488:536:14:-;1535:4;1900:12;1923:4;1900:28;;1938:10;1987:4;1975:17;1969:23;;2016:1;2010:2;:7;2003:14;;;;1488:536;:::o;719:142:15:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;793:6:15;784;;:15;;;;;;;;;;;;;;;;;;847:6;;;;;;;;;;;814:40;;843:1;814:40;;;;;;;;;;;;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;719:142:15;;:::o;499:116:6:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;570:38:6;595:12;570:24;:38::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;499:116:6;;:::o;2915:287:1:-;2984:4;2957:17;;:32;;;;;;;;;;;;;;;;;;3109:86;2213:66;3125:13;;3140:54;3109:8;:15;;:86;;;;;:::i;:::-;;2915:287::o;21297:101::-;;;;;:::o;26876:234:24:-;27023:4;27046:57;27090:4;27096:6;27046:10;:25;;:43;;:57;;;;;:::i;:::-;27039:64;;26876:234;;;;;:::o;2657:324:19:-;2767:4;2791:31;2803:13;2818:3;2791:11;:31::i;:::-;2787:188;;;2891:30;2917:3;2891:13;:18;;:25;;:30;;;;:::i;:::-;2884:37;;;;2787:188;2959:5;2952:12;;2657:324;;;;;:::o;3540:327::-;3694:4;3714:31;3726:13;3741:3;3714:11;:31::i;:::-;3710:151;;;3768:39;3801:5;3768:13;:18;;:23;3787:3;3768:23;;;;;;;;;;;:32;;:39;;;;:::i;:::-;3761:46;;;;3710:151;3845:5;3838:12;;3540:327;;;;;;:::o;2218:225:15:-;2311:1;2291:22;;:8;:22;;;;2283:73;;;;;;;;;;;;;;;;;;;;;;;;2400:8;2371:38;;2392:6;;;;;;;;;;;2371:38;;;;;;;;;;;;2428:8;2419:6;;:17;;;;;;;;;;;;;;;;;;2218:225;:::o;897:190:18:-;1021:4;1044:36;1076:3;1044:17;:22;;:31;;:36;;;;:::i;:::-;1037:43;;897:190;;;;:::o;803::21:-;925:4;952:34;982:3;952:15;:20;;:29;;:34;;;;:::i;:::-;945:41;;803:190;;;;:::o;1212:189:22:-;1335:4;1362:32;1390:3;1362:13;:18;;:27;;:32;;;;:::i;:::-;1355:39;;1212:189;;;;:::o;3034:265:18:-;3161:7;3188:35;3200:17;3219:3;3188:11;:35::i;:::-;3180:67;;;;;;;;;;;;;;;;;;;;;;;;3265:17;:22;;:27;3288:3;3265:27;;;;;;;;;;;;3258:34;;3034:265;;;;:::o;1036:273:20:-;1122:4;1147:20;1156:3;1161:5;1147:8;:20::i;:::-;1146:21;1142:161;;;1202:3;:10;;1218:5;1202:22;;39:1:-1;33:3;27:10;23:18;57:10;52:3;45:23;79:10;72:17;;0:93;1202:22:20;;;;;;;;;;;;;;;;;;;;;1183:3;:9;;:16;1193:5;1183:16;;;;;;;;;;;:41;;;;1245:4;1238:11;;;;1142:161;1287:5;1280:12;;1036:273;;;;;:::o;2669:1238:5:-;2724:14;3523:18;3544:8;;3523:29;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;3523:29:5;;;;;;;;3562:13;3578:8;;:15;;3562:31;;3825:42;3816:5;3809;3805:17;3799:24;3795:73;3785:83;;3894:6;3887:13;;;;2669:1238;:::o;2162:248:21:-;2308:4;2352:5;2324:15;:20;;:25;2345:3;2324:25;;;;;;;;;;;:33;;;;;;;;;;;;:::i;:::-;;2374:29;2399:3;2374:15;:20;;:24;;:29;;;;:::i;:::-;2367:36;;2162:248;;;;;:::o;1083:535:28:-;1209:15;1266:12;:19;1244:11;:18;:41;1236:70;;;;;;;;;;;;;;;;;;;;;;;;1317:23;1356:11;:18;1343:32;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;;;;;;;;;;;;;;;1317:58;;1390:9;1402:1;1390:13;;1385:202;1409:11;:18;1405:1;:22;1385:202;;;1448:17;;:::i;:::-;1490:11;1502:1;1490:14;;;;;;;;;;;;;;;;;;1479:3;:8;;:25;;;;;1531:12;1544:1;1531:15;;;;;;;;;;;;;;;;;;1518:3;:10;;:28;;;;;1573:3;1560:7;1568:1;1560:10;;;;;;;;;;;;;;;;;:16;;;;1385:202;1429:3;;;;;;;1385:202;;;;1604:7;1597:14;;;1083:535;;;;:::o;666:166:29:-;738:7;776:21;:6;:14;;;:19;:21::i;:::-;771:2;532;764:9;:33;757:40;;666:166;;;:::o;686:174:27:-;837:6;828;819:7;815:20;808:36;794:60;;;:::o;3133:509:28:-;3241:7;3260:14;3277:11;3260:28;;3321:35;3343:6;3351:4;3321:13;3326:7;3321:4;:13::i;:::-;:21;;:35;;;;;:::i;:::-;3376:2;3366:12;;;;3393:9;3405:1;3393:13;;3388:224;3412:7;:14;3408:1;:18;3388:224;;;3447:43;3477:6;3485:4;3447:7;3455:1;3447:10;;;;;;;;;;;;;;;;;;:15;;;:29;;:43;;;;;:::i;:::-;3514:2;3504:12;;;;3530:45;3562:6;3570:4;3530:7;3538:1;3530:10;;;;;;;;;;;;;;;;;;:17;;;:31;;:45;;;;;:::i;:::-;3599:2;3589:12;;;;3428:3;;;;;;;3388:224;;;;3629:6;3622:13;;;3133:509;;;;;:::o;2284:251:18:-;2429:4;2475:5;2445:17;:22;;:27;2468:3;2445:27;;;;;;;;;;;:35;;;;2497:31;2524:3;2497:17;:22;;:26;;:31;;;;:::i;:::-;2490:38;;2284:251;;;;;:::o;1439:1020:20:-;1528:4;1552:20;1561:3;1566:5;1552:8;:20::i;:::-;1548:905;;;1588:21;1631:1;1612:3;:9;;:16;1622:5;1612:16;;;;;;;;;;;;:20;1588:44;;1646:17;1686:1;1666:3;:10;;:17;;;;:21;1646:41;;1824:13;1811:9;:26;;1807:382;;;1857:17;1877:3;:10;;1888:9;1877:21;;;;;;;;;;;;;;;;;;1857:41;;2024:9;1996:3;:10;;2007:13;1996:25;;;;;;;;;;;;;;;;;:37;;;;2146:1;2130:13;:17;2107:3;:9;;:20;2117:9;2107:20;;;;;;;;;;;:40;;;;1807:382;;2270:3;:9;;:16;2280:5;2270:16;;;;;;;;;;;2263:23;;;2357:3;:10;;:16;;;;;;;;;;;;;;;;;;;;;;;;;;2395:4;2388:11;;;;;;1548:905;2437:5;2430:12;;1439:1020;;;;;:::o;2157:153:9:-;2231:7;2240:12;371:1;2295:7;2264:39;;;;2157:153;;;:::o;2693:335:18:-;2804:4;2828:35;2840:17;2859:3;2828:11;:35::i;:::-;2824:198;;;2886:17;:22;;:27;2909:3;2886:27;;;;;;;;;;;2879:34;;;2934;2964:3;2934:17;:22;;:29;;:34;;;;:::i;:::-;2927:41;;;;2824:198;3006:5;2999:12;;2693:335;;;;;:::o;2564:325:21:-;2671:4;2695:33;2707:15;2724:3;2695:11;:33::i;:::-;2691:192;;;2751:15;:20;;:25;2772:3;2751:25;;;;;;;;;;;;2744:32;;;;:::i;:::-;2797;2825:3;2797:15;:20;;:27;;:32;;;;:::i;:::-;2790:39;;;;2691:192;2867:5;2860:12;;2564:325;;;;;:::o;2878:322:22:-;2986:4;3010:31;3022:13;3037:3;3010:11;:31::i;:::-;3006:188;;;3110:30;3136:3;3110:13;:18;;:25;;:30;;;;:::i;:::-;3103:37;;;;3006:188;3178:5;3171:12;;2878:322;;;;;:::o;2895:262:21:-;3018:12;3050:33;3062:15;3079:3;3050:11;:33::i;:::-;3042:65;;;;;;;;;;;;;;;;;;;;;;;;3125:15;:20;;:25;3146:3;3125:25;;;;;;;;;;;3118:32;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;2895:262;;;;:::o;4371:349:25:-;4474:15;4557:6;4549;4545:19;4539:26;4528:37;;4514:200;;;;:::o;5339:641:28:-;5430:15;5447:7;5466:14;5483:11;5466:28;;5504:16;5523:24;5540:6;5523;:16;;:24;;;;:::i;:::-;5504:43;;5567:2;5557:12;;;;5580:11;377:2;5594:8;:15;;;;;;;;5580:29;;5619:22;5657:3;5644:17;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;;;;;;;;;;;;;;;5619:42;;5676:9;5688:1;5676:13;;5671:269;5695:3;5691:1;:7;5671:269;;;5719:20;;:::i;:::-;5767:24;5784:6;5767;:16;;:24;;;;:::i;:::-;5753:6;:11;;:38;;;;;5815:2;5805:12;;;;5847:24;5864:6;5847;:16;;:24;;;;:::i;:::-;5831:6;:13;;:40;;;;;5895:2;5885:12;;;;5923:6;5911;5918:1;5911:9;;;;;;;;;;;;;;;;;:18;;;;5671:269;5700:3;;;;;;;5671:269;;;;5958:6;5966;5950:23;;;;;;;;5339:641;;;;;:::o;2540:159:20:-;2644:4;2691:1;2671:3;:9;;:16;2681:5;2671:16;;;;;;;;;;;;:21;;2664:28;;2540:159;;;;:::o;3052:313::-;3142:16;3174:23;3214:3;:10;;:17;;;;3200:32;;;;;;;;;;;;;;;;;;;;;;29:2:-1;21:6;17:15;117:4;105:10;97:6;88:34;148:4;140:6;136:17;126:27;;0:157;3200:32:20;;;;3174:58;;3247:9;3242:94;3262:3;:10;;:17;;;;3258:1;:21;3242:94;;;3312:3;:10;;3323:1;3312:13;;;;;;;;;;;;;;;;;;3300:6;3307:1;3300:9;;;;;;;;;;;;;;;;;:25;;;;;3281:3;;;;;;;3242:94;;;;3352:6;3345:13;;;3052:313;;;:::o;913:254:5:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;1130:30:5;1147:12;1130:16;:30::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;913:254:5;;:::o;24588:1438:24:-;24730:4;24769:1;24760:5;24754:12;;;;;;;;:16;;;24746:48;;;;;;;;;;;;;;;;;;;;;;;;24826:42;24863:4;24826:10;:24;;:36;;:42;;;;:::i;:::-;24825:43;24804:122;;;;;;;;;;;;;;;;;;;;;;;;24958:45;24998:4;24958:10;:27;;:39;;:45;;;;:::i;:::-;24957:46;24936:125;;;;;;;;;;;;;;;;;;;;;;;;25093:43;25131:4;25093:10;:25;;:37;;:43;;;;:::i;:::-;25092:44;25071:123;;;;;;;;;;;;;;;;;;;;;;;;25226:46;25267:4;25226:10;:28;;:40;;:46;;;;:::i;:::-;25225:47;25204:126;;;;;;;;;;;;;;;;;;;;;;;;25378:5;25345:38;;;;;;;;:29;:38;;;;;;;;;25341:114;;;25406:38;25439:4;25406:10;:25;;:32;;:38;;;;:::i;:::-;25399:45;;;;25341:114;25504:5;25468:41;;;;;;;;:32;:41;;;;;;;;;25464:120;;;25532:41;25568:4;25532:10;:28;;:35;;:41;;;;:::i;:::-;25525:48;;;;25464:120;25629:5;25597:37;;;;;;;;:28;:37;;;;;;;;;25593:262;;;25673:171;25734:4;25760:66;25673:171;;:10;:24;;:39;;:171;;;;;:::i;:::-;25650:194;;;;25593:262;25903:5;25868:40;;;;;;;;:31;:40;;;;;;;;;25864:156;;;25947:62;25990:4;26006:1;25996:12;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;25996:12:24;;;;25947:10;:27;;:42;;:62;;;;;:::i;:::-;25924:85;;;;25864:156;24588:1438;;;;;;:::o;511:130:28:-;587:7;377:2;613:7;:14;:21;606:28;;511:130;;;:::o;2013:165:27:-;2155:6;2146;2137:7;2133:20;2126:36;2112:60;;;:::o;18218:210:25:-;18321:15;18404:6;18396;18392:19;18386:26;18375:37;;18361:61;;;;:::o;1427:541:5:-;1493:23;1519:14;:12;:14::i;:::-;1493:40;;1574:1;1551:25;;:11;:25;;;;1543:82;;;;;;;;;;;;;;;;;;;;;;;;1658:15;1643:30;;:11;:30;;;;1635:86;;;;;;;;;;;;;;;;;;;;;;;;1770:11;1737:45;;1753:15;1737:45;;;;;;;;;;;;1793:12;754:66;1808:30;;1793:45;;1940:11;1934:4;1927:25;1913:49;;;:::o;1040:166:22:-;1145:4;1172:27;1195:3;1172:13;:18;;:22;;:27;;;;:::i;:::-;1165:34;;1040:166;;;;:::o;640:21774:1:-;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;5:118:-1:-;;72:46;110:6;97:20;72:46;;;63:55;;57:66;;;;;130:134;;205:54;251:6;238:20;205:54;;;196:63;;190:74;;;;;289:707;;406:3;399:4;391:6;387:17;383:27;376:35;373:2;;;424:1;421;414:12;373:2;461:6;448:20;483:80;498:64;555:6;498:64;;;483:80;;;474:89;;580:5;605:6;598:5;591:21;635:4;627:6;623:17;613:27;;657:4;652:3;648:14;641:21;;710:6;757:3;749:4;741:6;737:17;732:3;728:27;725:36;722:2;;;774:1;771;764:12;722:2;799:1;784:206;809:6;806:1;803:13;784:206;;;867:3;889:37;922:3;910:10;889:37;;;884:3;877:50;950:4;945:3;941:14;934:21;;978:4;973:3;969:14;962:21;;841:149;831:1;828;824:9;819:14;;784:206;;;788:14;366:630;;;;;;;;1004:112;;1068:43;1103:6;1090:20;1068:43;;;1059:52;;1053:63;;;;;1123:118;;1190:46;1228:6;1215:20;1190:46;;;1181:55;;1175:66;;;;;1262:335;;;1376:3;1369:4;1361:6;1357:17;1353:27;1346:35;1343:2;;;1394:1;1391;1384:12;1343:2;1427:6;1414:20;1404:30;;1454:18;1446:6;1443:30;1440:2;;;1486:1;1483;1476:12;1440:2;1520:4;1512:6;1508:17;1496:29;;1570:3;1563;1555:6;1551:16;1541:8;1537:31;1534:40;1531:2;;;1587:1;1584;1577:12;1531:2;1336:261;;;;;;1606:440;;1707:3;1700:4;1692:6;1688:17;1684:27;1677:35;1674:2;;;1725:1;1722;1715:12;1674:2;1762:6;1749:20;1784:64;1799:48;1840:6;1799:48;;;1784:64;;;1775:73;;1868:6;1861:5;1854:21;1904:4;1896:6;1892:17;1937:4;1930:5;1926:16;1972:3;1963:6;1958:3;1954:16;1951:25;1948:2;;;1989:1;1986;1979:12;1948:2;1999:41;2033:6;2028:3;2023;1999:41;;;1667:379;;;;;;;;2054:118;;2121:46;2159:6;2146:20;2121:46;;;2112:55;;2106:66;;;;;2179:122;;2257:39;2288:6;2282:13;2257:39;;;2248:48;;2242:59;;;;;2308:114;;2373:44;2409:6;2396:20;2373:44;;;2364:53;;2358:64;;;;;2429:241;;2533:2;2521:9;2512:7;2508:23;2504:32;2501:2;;;2549:1;2546;2539:12;2501:2;2584:1;2601:53;2646:7;2637:6;2626:9;2622:22;2601:53;;;2591:63;;2563:97;2495:175;;;;;2677:257;;2789:2;2777:9;2768:7;2764:23;2760:32;2757:2;;;2805:1;2802;2795:12;2757:2;2840:1;2857:61;2910:7;2901:6;2890:9;2886:22;2857:61;;;2847:71;;2819:105;2751:183;;;;;2941:1497;;;;;;;;;;;;3220:3;3208:9;3199:7;3195:23;3191:33;3188:2;;;3237:1;3234;3227:12;3188:2;3272:1;3289:53;3334:7;3325:6;3314:9;3310:22;3289:53;;;3279:63;;3251:97;3379:2;3397:53;3442:7;3433:6;3422:9;3418:22;3397:53;;;3387:63;;3358:98;3515:2;3504:9;3500:18;3487:32;3539:18;3531:6;3528:30;3525:2;;;3571:1;3568;3561:12;3525:2;3599:64;3655:7;3646:6;3635:9;3631:22;3599:64;;;3581:82;;;;3466:203;3700:2;3718:53;3763:7;3754:6;3743:9;3739:22;3718:53;;;3708:63;;3679:98;3808:3;3827:53;3872:7;3863:6;3852:9;3848:22;3827:53;;;3817:63;;3787:99;3917:3;3936:53;3981:7;3972:6;3961:9;3957:22;3936:53;;;3926:63;;3896:99;4026:3;4045:53;4090:7;4081:6;4070:9;4066:22;4045:53;;;4035:63;;4005:99;4163:3;4152:9;4148:19;4135:33;4188:18;4180:6;4177:30;4174:2;;;4220:1;4217;4210:12;4174:2;4248:64;4304:7;4295:6;4284:9;4280:22;4248:64;;;4230:82;;;;4114:204;4349:3;4369:53;4414:7;4405:6;4394:9;4390:22;4369:53;;;4358:64;;4328:100;3182:1256;;;;;;;;;;;;;;;4445:241;;4549:2;4537:9;4528:7;4524:23;4520:32;4517:2;;;4565:1;4562;4555:12;4517:2;4600:1;4617:53;4662:7;4653:6;4642:9;4638:22;4617:53;;;4607:63;;4579:97;4511:175;;;;;4693:366;;;4814:2;4802:9;4793:7;4789:23;4785:32;4782:2;;;4830:1;4827;4820:12;4782:2;4865:1;4882:53;4927:7;4918:6;4907:9;4903:22;4882:53;;;4872:63;;4844:97;4972:2;4990:53;5035:7;5026:6;5015:9;5011:22;4990:53;;;4980:63;;4951:98;4776:283;;;;;;5066:889;;;;;5271:3;5259:9;5250:7;5246:23;5242:33;5239:2;;;5288:1;5285;5278:12;5239:2;5323:1;5340:53;5385:7;5376:6;5365:9;5361:22;5340:53;;;5330:63;;5302:97;5430:2;5448:53;5493:7;5484:6;5473:9;5469:22;5448:53;;;5438:63;;5409:98;5566:2;5555:9;5551:18;5538:32;5590:18;5582:6;5579:30;5576:2;;;5622:1;5619;5612:12;5576:2;5642:78;5712:7;5703:6;5692:9;5688:22;5642:78;;;5632:88;;5517:209;5785:2;5774:9;5770:18;5757:32;5809:18;5801:6;5798:30;5795:2;;;5841:1;5838;5831:12;5795:2;5861:78;5931:7;5922:6;5911:9;5907:22;5861:78;;;5851:88;;5736:209;5233:722;;;;;;;;5962:491;;;;6100:2;6088:9;6079:7;6075:23;6071:32;6068:2;;;6116:1;6113;6106:12;6068:2;6151:1;6168:53;6213:7;6204:6;6193:9;6189:22;6168:53;;;6158:63;;6130:97;6258:2;6276:53;6321:7;6312:6;6301:9;6297:22;6276:53;;;6266:63;;6237:98;6366:2;6384:53;6429:7;6420:6;6409:9;6405:22;6384:53;;;6374:63;;6345:98;6062:391;;;;;;6460:617;;;;;6615:3;6603:9;6594:7;6590:23;6586:33;6583:2;;;6632:1;6629;6622:12;6583:2;6667:1;6684:53;6729:7;6720:6;6709:9;6705:22;6684:53;;;6674:63;;6646:97;6774:2;6792:53;6837:7;6828:6;6817:9;6813:22;6792:53;;;6782:63;;6753:98;6882:2;6900:53;6945:7;6936:6;6925:9;6921:22;6900:53;;;6890:63;;6861:98;6990:2;7008:53;7053:7;7044:6;7033:9;7029:22;7008:53;;;6998:63;;6969:98;6577:500;;;;;;;;7084:743;;;;;;7256:3;7244:9;7235:7;7231:23;7227:33;7224:2;;;7273:1;7270;7263:12;7224:2;7308:1;7325:53;7370:7;7361:6;7350:9;7346:22;7325:53;;;7315:63;;7287:97;7415:2;7433:53;7478:7;7469:6;7458:9;7454:22;7433:53;;;7423:63;;7394:98;7523:2;7541:53;7586:7;7577:6;7566:9;7562:22;7541:53;;;7531:63;;7502:98;7631:2;7649:53;7694:7;7685:6;7674:9;7670:22;7649:53;;;7639:63;;7610:98;7739:3;7758:53;7803:7;7794:6;7783:9;7779:22;7758:53;;;7748:63;;7718:99;7218:609;;;;;;;;;7834:847;;;;;;8015:3;8003:9;7994:7;7990:23;7986:33;7983:2;;;8032:1;8029;8022:12;7983:2;8067:1;8084:53;8129:7;8120:6;8109:9;8105:22;8084:53;;;8074:63;;8046:97;8174:2;8192:53;8237:7;8228:6;8217:9;8213:22;8192:53;;;8182:63;;8153:98;8282:2;8300:53;8345:7;8336:6;8325:9;8321:22;8300:53;;;8290:63;;8261:98;8390:2;8408:53;8453:7;8444:6;8433:9;8429:22;8408:53;;;8398:63;;8369:98;8526:3;8515:9;8511:19;8498:33;8551:18;8543:6;8540:30;8537:2;;;8583:1;8580;8573:12;8537:2;8603:62;8657:7;8648:6;8637:9;8633:22;8603:62;;;8593:72;;8477:194;7977:704;;;;;;;;;8688:1011;;;;;;8908:3;8896:9;8887:7;8883:23;8879:33;8876:2;;;8925:1;8922;8915:12;8876:2;8960:1;8977:53;9022:7;9013:6;9002:9;8998:22;8977:53;;;8967:63;;8939:97;9067:2;9085:53;9130:7;9121:6;9110:9;9106:22;9085:53;;;9075:63;;9046:98;9175:2;9193:51;9236:7;9227:6;9216:9;9212:22;9193:51;;;9183:61;;9154:96;9309:2;9298:9;9294:18;9281:32;9333:18;9325:6;9322:30;9319:2;;;9365:1;9362;9355:12;9319:2;9385:78;9455:7;9446:6;9435:9;9431:22;9385:78;;;9375:88;;9260:209;9528:3;9517:9;9513:19;9500:33;9553:18;9545:6;9542:30;9539:2;;;9585:1;9582;9575:12;9539:2;9605:78;9675:7;9666:6;9655:9;9651:22;9605:78;;;9595:88;;9479:210;8870:829;;;;;;;;;9706:365;;;9829:2;9817:9;9808:7;9804:23;9800:32;9797:2;;;9845:1;9842;9835:12;9797:2;9908:1;9897:9;9893:17;9880:31;9931:18;9923:6;9920:30;9917:2;;;9963:1;9960;9953:12;9917:2;9991:64;10047:7;10038:6;10027:9;10023:22;9991:64;;;9973:82;;;;9859:202;9791:280;;;;;;10078:735;;;;;;10249:3;10237:9;10228:7;10224:23;10220:33;10217:2;;;10266:1;10263;10256:12;10217:2;10329:1;10318:9;10314:17;10301:31;10352:18;10344:6;10341:30;10338:2;;;10384:1;10381;10374:12;10338:2;10412:64;10468:7;10459:6;10448:9;10444:22;10412:64;;;10394:82;;;;10280:202;10513:2;10531:50;10573:7;10564:6;10553:9;10549:22;10531:50;;;10521:60;;10492:95;10618:2;10636:53;10681:7;10672:6;10661:9;10657:22;10636:53;;;10626:63;;10597:98;10726:2;10744:53;10789:7;10780:6;10769:9;10765:22;10744:53;;;10734:63;;10705:98;10211:602;;;;;;;;;10820:241;;10924:2;10912:9;10903:7;10899:23;10895:32;10892:2;;;10940:1;10937;10930:12;10892:2;10975:1;10992:53;11037:7;11028:6;11017:9;11013:22;10992:53;;;10982:63;;10954:97;10886:175;;;;;11068:263;;11183:2;11171:9;11162:7;11158:23;11154:32;11151:2;;;11199:1;11196;11189:12;11151:2;11234:1;11251:64;11307:7;11298:6;11287:9;11283:22;11251:64;;;11241:74;;11213:108;11145:186;;;;;11338:382;;;11467:2;11455:9;11446:7;11442:23;11438:32;11435:2;;;11483:1;11480;11473:12;11435:2;11518:1;11535:53;11580:7;11571:6;11560:9;11556:22;11535:53;;;11525:63;;11497:97;11625:2;11643:61;11696:7;11687:6;11676:9;11672:22;11643:61;;;11633:71;;11604:106;11429:291;;;;;;11727:132;11808:45;11847:5;11808:45;;;11803:3;11796:58;11790:69;;;11866:134;11955:39;11988:5;11955:39;;;11950:3;11943:52;11937:63;;;12007:110;12080:31;12105:5;12080:31;;;12075:3;12068:44;12062:55;;;12155:590;;12290:54;12338:5;12290:54;;;12362:6;12357:3;12350:19;12386:4;12381:3;12377:14;12370:21;;12431:56;12481:5;12431:56;;;12508:1;12493:230;12518:6;12515:1;12512:13;12493:230;;;12558:53;12607:3;12598:6;12592:13;12558:53;;;12628:60;12681:6;12628:60;;;12618:70;;12711:4;12706:3;12702:14;12695:21;;12540:1;12537;12533:9;12528:14;;12493:230;;;12497:14;12736:3;12729:10;;12269:476;;;;;;;12816:718;;12987:70;13051:5;12987:70;;;13075:6;13070:3;13063:19;13099:4;13094:3;13090:14;13083:21;;13144:72;13210:5;13144:72;;;13237:1;13222:290;13247:6;13244:1;13241:13;13222:290;;;13287:97;13380:3;13371:6;13365:13;13287:97;;;13401:76;13470:6;13401:76;;;13391:86;;13500:4;13495:3;13491:14;13484:21;;13269:1;13266;13262:9;13257:14;;13222:290;;;13226:14;13525:3;13518:10;;12966:568;;;;;;;13542:101;13609:28;13631:5;13609:28;;;13604:3;13597:41;13591:52;;;13650:110;13723:31;13748:5;13723:31;;;13718:3;13711:44;13705:55;;;13767:107;13838:30;13862:5;13838:30;;;13833:3;13826:43;13820:54;;;13881:297;;13981:38;14013:5;13981:38;;;14036:6;14031:3;14024:19;14048:63;14104:6;14097:4;14092:3;14088:14;14081:4;14074:5;14070:16;14048:63;;;14143:29;14165:6;14143:29;;;14136:4;14131:3;14127:14;14123:50;14116:57;;13961:217;;;;;;14185:300;;14287:39;14320:5;14287:39;;;14343:6;14338:3;14331:19;14355:63;14411:6;14404:4;14399:3;14395:14;14388:4;14381:5;14377:16;14355:63;;;14450:29;14472:6;14450:29;;;14443:4;14438:3;14434:14;14430:50;14423:57;;14267:218;;;;;;14493:296;;14648:2;14643:3;14636:15;14685:66;14680:2;14675:3;14671:12;14664:88;14780:2;14775:3;14771:12;14764:19;;14629:160;;;;14798:397;;14953:2;14948:3;14941:15;14990:66;14985:2;14980:3;14976:12;14969:88;15091:66;15086:2;15081:3;15077:12;15070:88;15186:2;15181:3;15177:12;15170:19;;14934:261;;;;15204:296;;15359:2;15354:3;15347:15;15396:66;15391:2;15386:3;15382:12;15375:88;15491:2;15486:3;15482:12;15475:19;;15340:160;;;;15509:296;;15664:2;15659:3;15652:15;15701:66;15696:2;15691:3;15687:12;15680:88;15796:2;15791:3;15787:12;15780:19;;15645:160;;;;15814:397;;15969:2;15964:3;15957:15;16006:66;16001:2;15996:3;15992:12;15985:88;16107:66;16102:2;16097:3;16093:12;16086:88;16202:2;16197:3;16193:12;16186:19;;15950:261;;;;16220:296;;16375:2;16370:3;16363:15;16412:66;16407:2;16402:3;16398:12;16391:88;16507:2;16502:3;16498:12;16491:19;;16356:160;;;;16525:397;;16680:2;16675:3;16668:15;16717:66;16712:2;16707:3;16703:12;16696:88;16818:66;16813:2;16808:3;16804:12;16797:88;16913:2;16908:3;16904:12;16897:19;;16661:261;;;;16931:397;;17086:2;17081:3;17074:15;17123:66;17118:2;17113:3;17109:12;17102:88;17224:66;17219:2;17214:3;17210:12;17203:88;17319:2;17314:3;17310:12;17303:19;;17067:261;;;;17337:296;;17492:2;17487:3;17480:15;17529:66;17524:2;17519:3;17515:12;17508:88;17624:2;17619:3;17615:12;17608:19;;17473:160;;;;17642:296;;17797:2;17792:3;17785:15;17834:66;17829:2;17824:3;17820:12;17813:88;17929:2;17924:3;17920:12;17913:19;;17778:160;;;;17947:296;;18102:2;18097:3;18090:15;18139:66;18134:2;18129:3;18125:12;18118:88;18234:2;18229:3;18225:12;18218:19;;18083:160;;;;18252:397;;18407:2;18402:3;18395:15;18444:66;18439:2;18434:3;18430:12;18423:88;18545:66;18540:2;18535:3;18531:12;18524:88;18640:2;18635:3;18631:12;18624:19;;18388:261;;;;18658:397;;18813:2;18808:3;18801:15;18850:66;18845:2;18840:3;18836:12;18829:88;18951:66;18946:2;18941:3;18937:12;18930:88;19046:2;19041:3;19037:12;19030:19;;18794:261;;;;19064:296;;19219:2;19214:3;19207:15;19256:66;19251:2;19246:3;19242:12;19235:88;19351:2;19346:3;19342:12;19335:19;;19200:160;;;;19369:296;;19524:2;19519:3;19512:15;19561:66;19556:2;19551:3;19547:12;19540:88;19656:2;19651:3;19647:12;19640:19;;19505:160;;;;19674:397;;19829:2;19824:3;19817:15;19866:66;19861:2;19856:3;19852:12;19845:88;19967:66;19962:2;19957:3;19953:12;19946:88;20062:2;20057:3;20053:12;20046:19;;19810:261;;;;20080:296;;20235:2;20230:3;20223:15;20272:66;20267:2;20262:3;20258:12;20251:88;20367:2;20362:3;20358:12;20351:19;;20216:160;;;;20385:397;;20540:2;20535:3;20528:15;20577:66;20572:2;20567:3;20563:12;20556:88;20678:66;20673:2;20668:3;20664:12;20657:88;20773:2;20768:3;20764:12;20757:19;;20521:261;;;;20791:397;;20946:2;20941:3;20934:15;20983:66;20978:2;20973:3;20969:12;20962:88;21084:66;21079:2;21074:3;21070:12;21063:88;21179:2;21174:3;21170:12;21163:19;;20927:261;;;;21197:296;;21352:2;21347:3;21340:15;21389:66;21384:2;21379:3;21375:12;21368:88;21484:2;21479:3;21475:12;21468:19;;21333:160;;;;21502:296;;21657:2;21652:3;21645:15;21694:66;21689:2;21684:3;21680:12;21673:88;21789:2;21784:3;21780:12;21773:19;;21638:160;;;;21807:296;;21962:2;21957:3;21950:15;21999:66;21994:2;21989:3;21985:12;21978:88;22094:2;22089:3;22085:12;22078:19;;21943:160;;;;22112:296;;22267:2;22262:3;22255:15;22304:66;22299:2;22294:3;22290:12;22283:88;22399:2;22394:3;22390:12;22383:19;;22248:160;;;;22417:296;;22572:2;22567:3;22560:15;22609:66;22604:2;22599:3;22595:12;22588:88;22704:2;22699:3;22695:12;22688:19;;22553:160;;;;22722:296;;22877:2;22872:3;22865:15;22914:66;22909:2;22904:3;22900:12;22893:88;23009:2;23004:3;23000:12;22993:19;;22858:160;;;;23027:296;;23182:2;23177:3;23170:15;23219:66;23214:2;23209:3;23205:12;23198:88;23314:2;23309:3;23305:12;23298:19;;23163:160;;;;23332:296;;23487:2;23482:3;23475:15;23524:66;23519:2;23514:3;23510:12;23503:88;23619:2;23614:3;23610:12;23603:19;;23468:160;;;;23693:488;23820:4;23815:3;23811:14;23906:3;23899:5;23895:15;23889:22;23923:61;23979:3;23974;23970:13;23957:11;23923:61;;;23840:156;24074:4;24067:5;24063:16;24057:23;24092:62;24148:4;24143:3;24139:14;24126:11;24092:62;;;24006:160;23793:388;;;;24241:641;;24380:4;24375:3;24371:14;24466:3;24459:5;24455:15;24449:22;24483:61;24539:3;24534;24530:13;24517:11;24483:61;;;24400:156;24635:4;24628:5;24624:16;24618:23;24686:3;24680:4;24676:14;24669:4;24664:3;24660:14;24653:38;24706:138;24839:4;24826:11;24706:138;;;24698:146;;24566:290;24873:4;24866:11;;24353:529;;;;;;24889:110;24962:31;24987:5;24962:31;;;24957:3;24950:44;24944:55;;;25006:107;25077:30;25101:5;25077:30;;;25072:3;25065:43;25059:54;;;25120:193;;25228:2;25217:9;25213:18;25205:26;;25242:61;25300:1;25289:9;25285:17;25276:6;25242:61;;;25199:114;;;;;25320:209;;25436:2;25425:9;25421:18;25413:26;;25450:69;25516:1;25505:9;25501:17;25492:6;25450:69;;;25407:122;;;;;25536:290;;25670:2;25659:9;25655:18;25647:26;;25684:61;25742:1;25731:9;25727:17;25718:6;25684:61;;;25756:60;25812:2;25801:9;25797:18;25788:6;25756:60;;;25641:185;;;;;;25833:341;;25991:2;25980:9;25976:18;25968:26;;26041:9;26035:4;26031:20;26027:1;26016:9;26012:17;26005:47;26066:98;26159:4;26150:6;26066:98;;;26058:106;;25962:212;;;;;26181:181;;26283:2;26272:9;26268:18;26260:26;;26297:55;26349:1;26338:9;26334:17;26325:6;26297:55;;;26254:108;;;;;26369:193;;26477:2;26466:9;26462:18;26454:26;;26491:61;26549:1;26538:9;26534:17;26525:6;26491:61;;;26448:114;;;;;26569:294;;26705:2;26694:9;26690:18;26682:26;;26719:61;26777:1;26766:9;26762:17;26753:6;26719:61;;;26791:62;26849:2;26838:9;26834:18;26825:6;26791:62;;;26676:187;;;;;;26870:277;;26996:2;26985:9;26981:18;26973:26;;27046:9;27040:4;27036:20;27032:1;27021:9;27017:17;27010:47;27071:66;27132:4;27123:6;27071:66;;;27063:74;;26967:180;;;;;27154:281;;27282:2;27271:9;27267:18;27259:26;;27332:9;27326:4;27322:20;27318:1;27307:9;27303:17;27296:47;27357:68;27420:4;27411:6;27357:68;;;27349:76;;27253:182;;;;;27442:387;;27623:2;27612:9;27608:18;27600:26;;27673:9;27667:4;27663:20;27659:1;27648:9;27644:17;27637:47;27698:121;27814:4;27698:121;;;27690:129;;27594:235;;;;27836:387;;28017:2;28006:9;28002:18;27994:26;;28067:9;28061:4;28057:20;28053:1;28042:9;28038:17;28031:47;28092:121;28208:4;28092:121;;;28084:129;;27988:235;;;;28230:387;;28411:2;28400:9;28396:18;28388:26;;28461:9;28455:4;28451:20;28447:1;28436:9;28432:17;28425:47;28486:121;28602:4;28486:121;;;28478:129;;28382:235;;;;28624:387;;28805:2;28794:9;28790:18;28782:26;;28855:9;28849:4;28845:20;28841:1;28830:9;28826:17;28819:47;28880:121;28996:4;28880:121;;;28872:129;;28776:235;;;;29018:387;;29199:2;29188:9;29184:18;29176:26;;29249:9;29243:4;29239:20;29235:1;29224:9;29220:17;29213:47;29274:121;29390:4;29274:121;;;29266:129;;29170:235;;;;29412:387;;29593:2;29582:9;29578:18;29570:26;;29643:9;29637:4;29633:20;29629:1;29618:9;29614:17;29607:47;29668:121;29784:4;29668:121;;;29660:129;;29564:235;;;;29806:387;;29987:2;29976:9;29972:18;29964:26;;30037:9;30031:4;30027:20;30023:1;30012:9;30008:17;30001:47;30062:121;30178:4;30062:121;;;30054:129;;29958:235;;;;30200:387;;30381:2;30370:9;30366:18;30358:26;;30431:9;30425:4;30421:20;30417:1;30406:9;30402:17;30395:47;30456:121;30572:4;30456:121;;;30448:129;;30352:235;;;;30594:387;;30775:2;30764:9;30760:18;30752:26;;30825:9;30819:4;30815:20;30811:1;30800:9;30796:17;30789:47;30850:121;30966:4;30850:121;;;30842:129;;30746:235;;;;30988:387;;31169:2;31158:9;31154:18;31146:26;;31219:9;31213:4;31209:20;31205:1;31194:9;31190:17;31183:47;31244:121;31360:4;31244:121;;;31236:129;;31140:235;;;;31382:387;;31563:2;31552:9;31548:18;31540:26;;31613:9;31607:4;31603:20;31599:1;31588:9;31584:17;31577:47;31638:121;31754:4;31638:121;;;31630:129;;31534:235;;;;31776:387;;31957:2;31946:9;31942:18;31934:26;;32007:9;32001:4;31997:20;31993:1;31982:9;31978:17;31971:47;32032:121;32148:4;32032:121;;;32024:129;;31928:235;;;;32170:387;;32351:2;32340:9;32336:18;32328:26;;32401:9;32395:4;32391:20;32387:1;32376:9;32372:17;32365:47;32426:121;32542:4;32426:121;;;32418:129;;32322:235;;;;32564:387;;32745:2;32734:9;32730:18;32722:26;;32795:9;32789:4;32785:20;32781:1;32770:9;32766:17;32759:47;32820:121;32936:4;32820:121;;;32812:129;;32716:235;;;;32958:387;;33139:2;33128:9;33124:18;33116:26;;33189:9;33183:4;33179:20;33175:1;33164:9;33160:17;33153:47;33214:121;33330:4;33214:121;;;33206:129;;33110:235;;;;33352:387;;33533:2;33522:9;33518:18;33510:26;;33583:9;33577:4;33573:20;33569:1;33558:9;33554:17;33547:47;33608:121;33724:4;33608:121;;;33600:129;;33504:235;;;;33746:387;;33927:2;33916:9;33912:18;33904:26;;33977:9;33971:4;33967:20;33963:1;33952:9;33948:17;33941:47;34002:121;34118:4;34002:121;;;33994:129;;33898:235;;;;34140:387;;34321:2;34310:9;34306:18;34298:26;;34371:9;34365:4;34361:20;34357:1;34346:9;34342:17;34335:47;34396:121;34512:4;34396:121;;;34388:129;;34292:235;;;;34534:387;;34715:2;34704:9;34700:18;34692:26;;34765:9;34759:4;34755:20;34751:1;34740:9;34736:17;34729:47;34790:121;34906:4;34790:121;;;34782:129;;34686:235;;;;34928:387;;35109:2;35098:9;35094:18;35086:26;;35159:9;35153:4;35149:20;35145:1;35134:9;35130:17;35123:47;35184:121;35300:4;35184:121;;;35176:129;;35080:235;;;;35322:387;;35503:2;35492:9;35488:18;35480:26;;35553:9;35547:4;35543:20;35539:1;35528:9;35524:17;35517:47;35578:121;35694:4;35578:121;;;35570:129;;35474:235;;;;35716:387;;35897:2;35886:9;35882:18;35874:26;;35947:9;35941:4;35937:20;35933:1;35922:9;35918:17;35911:47;35972:121;36088:4;35972:121;;;35964:129;;35868:235;;;;36110:387;;36291:2;36280:9;36276:18;36268:26;;36341:9;36335:4;36331:20;36327:1;36316:9;36312:17;36305:47;36366:121;36482:4;36366:121;;;36358:129;;36262:235;;;;36504:387;;36685:2;36674:9;36670:18;36662:26;;36735:9;36729:4;36725:20;36721:1;36710:9;36706:17;36699:47;36760:121;36876:4;36760:121;;;36752:129;;36656:235;;;;36898:387;;37079:2;37068:9;37064:18;37056:26;;37129:9;37123:4;37119:20;37115:1;37104:9;37100:17;37093:47;37154:121;37270:4;37154:121;;;37146:129;;37050:235;;;;37292:387;;37473:2;37462:9;37458:18;37450:26;;37523:9;37517:4;37513:20;37509:1;37498:9;37494:17;37487:47;37548:121;37664:4;37548:121;;;37540:129;;37444:235;;;;37686:387;;37867:2;37856:9;37852:18;37844:26;;37917:9;37911:4;37907:20;37903:1;37892:9;37888:17;37881:47;37942:121;38058:4;37942:121;;;37934:129;;37838:235;;;;38080:337;;38236:2;38225:9;38221:18;38213:26;;38286:9;38280:4;38276:20;38272:1;38261:9;38257:17;38250:47;38311:96;38402:4;38393:6;38311:96;;;38303:104;;38207:210;;;;;38424:193;;38532:2;38521:9;38517:18;38509:26;;38546:61;38604:1;38593:9;38589:17;38580:6;38546:61;;;38503:114;;;;;38624:294;;38760:2;38749:9;38745:18;38737:26;;38774:61;38832:1;38821:9;38817:17;38808:6;38774:61;;;38846:62;38904:2;38893:9;38889:18;38880:6;38846:62;;;38731:187;;;;;;38925:326;;39077:2;39066:9;39062:18;39054:26;;39091:61;39149:1;39138:9;39134:17;39125:6;39091:61;;;39163:78;39237:2;39226:9;39222:18;39213:6;39163:78;;;39048:203;;;;;;39258:378;;39412:2;39401:9;39397:18;39389:26;;39426:61;39484:1;39473:9;39469:17;39460:6;39426:61;;;39535:9;39529:4;39525:20;39520:2;39509:9;39505:18;39498:48;39560:66;39621:4;39612:6;39560:66;;;39552:74;;39383:253;;;;;;39643:189;;39749:2;39738:9;39734:18;39726:26;;39763:59;39819:1;39808:9;39804:17;39795:6;39763:59;;;39720:112;;;;;39839:256;;39901:2;39895:9;39885:19;;39939:4;39931:6;39927:17;40038:6;40026:10;40023:22;40002:18;39990:10;39987:34;39984:62;39981:2;;;40059:1;40056;40049:12;39981:2;40079:10;40075:2;40068:22;39879:216;;;;;40102:258;;40261:18;40253:6;40250:30;40247:2;;;40293:1;40290;40283:12;40247:2;40322:4;40314:6;40310:17;40302:25;;40350:4;40344;40340:15;40332:23;;40184:176;;;;40367:258;;40510:18;40502:6;40499:30;40496:2;;;40542:1;40539;40532:12;40496:2;40586:4;40582:9;40575:4;40567:6;40563:17;40559:33;40551:41;;40615:4;40609;40605:15;40597:23;;40433:192;;;;40634:121;;40743:4;40735:6;40731:17;40720:28;;40712:43;;;;40766:137;;40891:4;40883:6;40879:17;40868:28;;40860:43;;;;40912:107;;41008:5;41002:12;40992:22;;40986:33;;;;41026:123;;41138:5;41132:12;41122:22;;41116:33;;;;41156:91;;41236:5;41230:12;41220:22;;41214:33;;;;41254:92;;41335:5;41329:12;41319:22;;41313:33;;;;41354:122;;41465:4;41457:6;41453:17;41442:28;;41435:41;;;;41485:138;;41612:4;41604:6;41600:17;41589:28;;41582:41;;;;41631:105;;41700:31;41725:5;41700:31;;;41689:42;;41683:53;;;;41743:113;;41820:31;41845:5;41820:31;;;41809:42;;41803:53;;;;41863:92;;41943:5;41936:13;41929:21;41918:32;;41912:43;;;;41962:79;;42031:5;42020:16;;42014:27;;;;42048:151;;42127:66;42120:5;42116:78;42105:89;;42099:100;;;;42206:128;;42286:42;42279:5;42275:54;42264:65;;42258:76;;;;42341:79;;42410:5;42399:16;;42393:27;;;;42427:97;;42506:12;42499:5;42495:24;42484:35;;42478:46;;;;42531:105;;42600:31;42625:5;42600:31;;;42589:42;;42583:53;;;;42643:113;;42720:31;42745:5;42720:31;;;42709:42;;42703:53;;;;42763:92;;42843:5;42836:13;42829:21;42818:32;;42812:43;;;;42862:79;;42931:5;42920:16;;42914:27;;;;42948:79;;43017:5;43006:16;;43000:27;;;;43034:88;;43112:4;43105:5;43101:16;43090:27;;43084:38;;;;43129:129;;43216:37;43247:5;43216:37;;;43203:50;;43197:61;;;;43265:121;;43344:37;43375:5;43344:37;;;43331:50;;43325:61;;;;43393:115;;43472:31;43497:5;43472:31;;;43459:44;;43453:55;;;;43516:145;43597:6;43592:3;43587;43574:30;43653:1;43644:6;43639:3;43635:16;43628:27;43567:94;;;;43670:268;43735:1;43742:101;43756:6;43753:1;43750:13;43742:101;;;43832:1;43827:3;43823:11;43817:18;43813:1;43808:3;43804:11;43797:39;43778:2;43775:1;43771:10;43766:15;;43742:101;;;43858:6;43855:1;43852:13;43849:2;;;43923:1;43914:6;43909:3;43905:16;43898:27;43849:2;43719:219;;;;;43946:97;;44034:2;44030:7;44025:2;44018:5;44014:14;44010:28;44000:38;;43994:49;;;";
var abi = [
	{
		constant: true,
		inputs: [
		],
		name: "getCurDay",
		outputs: [
			{
				name: "",
				type: "uint256"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "amt",
				type: "uint256"
			},
			{
				name: "dest",
				type: "address"
			}
		],
		name: "withdraw",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "gsnMaxCallsPerDay",
		outputs: [
			{
				name: "",
				type: "uint40"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "key",
				type: "bytes32"
			}
		],
		name: "checkDataKey",
		outputs: [
			{
				name: "",
				type: "bool"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "getTables",
		outputs: [
			{
				name: "",
				type: "bytes32[]"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "idTableKey",
				type: "bytes32"
			}
		],
		name: "getRowOwner",
		outputs: [
			{
				name: "rowOwner",
				type: "address"
			},
			{
				name: "createdDate",
				type: "bytes4"
			}
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableName",
				type: "bytes32"
			},
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "permission",
				type: "uint8"
			},
			{
				name: "columnName",
				type: "bytes32[]"
			},
			{
				name: "columnDtype",
				type: "bytes32[]"
			}
		],
		name: "createTable",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "getGSNBalance",
		outputs: [
			{
				name: "",
				type: "uint256"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "idKey",
				type: "bytes32"
			},
			{
				name: "fieldKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			},
			{
				name: "val",
				type: "bytes"
			}
		],
		name: "insertValVar",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "schemasTables",
		outputs: [
			{
				name: "",
				type: "bytes32"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "fieldIdTableKey",
				type: "bytes32"
			}
		],
		name: "getRowValue",
		outputs: [
			{
				name: "",
				type: "bytes32"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
		],
		name: "renounceOwnership",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "getHubAddr",
		outputs: [
			{
				name: "",
				type: "address"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableName",
				type: "bytes32"
			},
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "columnName",
				type: "bytes32[]"
			},
			{
				name: "columnDtype",
				type: "bytes32[]"
			}
		],
		name: "saveSchema",
		outputs: [
			{
				name: "",
				type: "bool"
			}
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "idKey",
				type: "bytes32"
			},
			{
				name: "fieldKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			},
			{
				name: "val",
				type: "bytes32"
			}
		],
		name: "updateVal",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "context",
				type: "bytes"
			}
		],
		name: "preRelayedCall",
		outputs: [
			{
				name: "",
				type: "bytes32"
			}
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "idKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			}
		],
		name: "deleteRow",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "relay",
				type: "address"
			},
			{
				name: "from",
				type: "address"
			},
			{
				name: "encodedFunction",
				type: "bytes"
			},
			{
				name: "transactionFee",
				type: "uint256"
			},
			{
				name: "gasPrice",
				type: "uint256"
			},
			{
				name: "gasLimit",
				type: "uint256"
			},
			{
				name: "nonce",
				type: "uint256"
			},
			{
				name: "approvalData",
				type: "bytes"
			},
			{
				name: "maxPossibleCharge",
				type: "uint256"
			}
		],
		name: "acceptRelayedCall",
		outputs: [
			{
				name: "",
				type: "uint256"
			},
			{
				name: "",
				type: "bytes"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "idKey",
				type: "bytes32"
			},
			{
				name: "fieldKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			}
		],
		name: "deleteVal",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "owner",
		outputs: [
			{
				name: "",
				type: "address"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "isOwner",
		outputs: [
			{
				name: "",
				type: "bool"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "_name",
				type: "bytes32"
			}
		],
		name: "getSchema",
		outputs: [
			{
				components: [
					{
						name: "name",
						type: "bytes32"
					},
					{
						components: [
							{
								name: "name",
								type: "bytes32"
							},
							{
								name: "_dtype",
								type: "bytes32"
							}
						],
						name: "columns",
						type: "tuple[]"
					}
				],
				name: "",
				type: "tuple"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "",
				type: "uint256"
			}
		],
		name: "gsnCounter",
		outputs: [
			{
				name: "",
				type: "uint256"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: true,
		inputs: [
		],
		name: "relayHubVersion",
		outputs: [
			{
				name: "",
				type: "string"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "idKey",
				type: "bytes32"
			},
			{
				name: "fieldKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			},
			{
				name: "val",
				type: "bytes32"
			}
		],
		name: "insertVal",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "max",
				type: "uint256"
			}
		],
		name: "setGsnMaxCallsPerDay",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			}
		],
		name: "getTableIds",
		outputs: [
			{
				name: "",
				type: "bytes32[]"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "relayHubAddr",
				type: "address"
			}
		],
		name: "initialize",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "_tableKey",
				type: "bytes32"
			}
		],
		name: "getTableMetadata",
		outputs: [
			{
				name: "permission",
				type: "uint256"
			},
			{
				name: "delegate",
				type: "address"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "context",
				type: "bytes"
			},
			{
				name: "success",
				type: "bool"
			},
			{
				name: "actualCharge",
				type: "uint256"
			},
			{
				name: "preRetVal",
				type: "bytes32"
			}
		],
		name: "postRelayedCall",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "fieldIdTableKey",
				type: "bytes32"
			}
		],
		name: "getRowValueVar",
		outputs: [
			{
				name: "",
				type: "bytes"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "tableName",
				type: "bytes32"
			},
			{
				name: "tableKey",
				type: "bytes32"
			}
		],
		name: "deleteTable",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: true,
		inputs: [
			{
				name: "tableKey",
				type: "bytes32"
			},
			{
				name: "id",
				type: "bytes32"
			}
		],
		name: "getIdExists",
		outputs: [
			{
				name: "",
				type: "bool"
			}
		],
		payable: false,
		stateMutability: "view",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "newOwner",
				type: "address"
			}
		],
		name: "transferOwnership",
		outputs: [
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		constant: false,
		inputs: [
			{
				name: "dest",
				type: "address"
			}
		],
		name: "withdrawAll",
		outputs: [
			{
				name: "",
				type: "uint256"
			}
		],
		payable: false,
		stateMutability: "nonpayable",
		type: "function"
	},
	{
		payable: true,
		stateMutability: "payable",
		type: "fallback"
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: true,
				name: "tableKey",
				type: "bytes32"
			},
			{
				indexed: true,
				name: "fieldKey",
				type: "bytes32"
			},
			{
				indexed: true,
				name: "val",
				type: "bytes32"
			},
			{
				indexed: false,
				name: "id",
				type: "bytes32"
			},
			{
				indexed: false,
				name: "owner",
				type: "address"
			}
		],
		name: "InsertVal",
		type: "event"
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: true,
				name: "oldRelayHub",
				type: "address"
			},
			{
				indexed: true,
				name: "newRelayHub",
				type: "address"
			}
		],
		name: "RelayHubChanged",
		type: "event"
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: true,
				name: "previousOwner",
				type: "address"
			},
			{
				indexed: true,
				name: "newOwner",
				type: "address"
			}
		],
		name: "OwnershipTransferred",
		type: "event"
	}
];
var ast = {
	absolutePath: "contracts/ELAJSStore.sol",
	exportedSymbols: {
		ELAJSStore: [
			2048
		]
	},
	id: 2049,
	nodeType: "SourceUnit",
	nodes: [
		{
			id: 770,
			literals: [
				"solidity",
				"^",
				"0.5",
				".0"
			],
			nodeType: "PragmaDirective",
			src: "0:23:1"
		},
		{
			id: 771,
			literals: [
				"experimental",
				"ABIEncoderV2"
			],
			nodeType: "PragmaDirective",
			src: "24:33:1"
		},
		{
			absolutePath: "sol-datastructs/src/contracts/PolymorphicDictionaryLib.sol",
			file: "sol-datastructs/src/contracts/PolymorphicDictionaryLib.sol",
			id: 772,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 8527,
			src: "59:68:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol",
			file: "sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol",
			id: 773,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 6087,
			src: "197:67:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "sol-sql/src/contracts/src/structs/TableLib.sol",
			file: "sol-sql/src/contracts/src/structs/TableLib.sol",
			id: 774,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 10534,
			src: "313:56:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/ozEla/OwnableELA.sol",
			file: "./ozEla/OwnableELA.sol",
			id: 775,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 4617,
			src: "371:32:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/gsnEla/GSNRecipientELA.sol",
			file: "./gsnEla/GSNRecipientELA.sol",
			id: 776,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 3296,
			src: "404:38:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/gsnEla/IRelayHubELA.sol",
			file: "./gsnEla/IRelayHubELA.sol",
			id: 777,
			nodeType: "ImportDirective",
			scope: 2049,
			sourceUnit: 3549,
			src: "443:35:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			baseContracts: [
				{
					"arguments": null,
					baseName: {
						contractScope: null,
						id: 778,
						name: "OwnableELA",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 4616,
						src: "663:10:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_OwnableELA_$4616",
							typeString: "contract OwnableELA"
						}
					},
					id: 779,
					nodeType: "InheritanceSpecifier",
					src: "663:10:1"
				},
				{
					"arguments": null,
					baseName: {
						contractScope: null,
						id: 780,
						name: "GSNRecipientELA",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 3295,
						src: "675:15:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_GSNRecipientELA_$3295",
							typeString: "contract GSNRecipientELA"
						}
					},
					id: 781,
					nodeType: "InheritanceSpecifier",
					src: "675:15:1"
				}
			],
			contractDependencies: [
				3229,
				3295,
				3599,
				3749,
				4423,
				4492,
				4616
			],
			contractKind: "contract",
			documentation: null,
			fullyImplemented: true,
			id: 2048,
			linearizedBaseContracts: [
				2048,
				3295,
				3749,
				3229,
				3599,
				4616,
				4423,
				4492
			],
			name: "ELAJSStore",
			nodeType: "ContractDefinition",
			nodes: [
				{
					constant: true,
					id: 784,
					name: "DAY_IN_SECONDS",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "698:36:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_uint256",
						typeString: "uint256"
					},
					typeName: {
						id: 782,
						name: "uint",
						nodeType: "ElementaryTypeName",
						src: "698:4:1",
						typeDescriptions: {
							typeIdentifier: "t_uint256",
							typeString: "uint256"
						}
					},
					value: {
						argumentTypes: null,
						hexValue: "3836343030",
						id: 783,
						isConstant: false,
						isLValue: false,
						isPure: true,
						kind: "number",
						lValueRequested: false,
						nodeType: "Literal",
						src: "729:5:1",
						subdenomination: null,
						typeDescriptions: {
							typeIdentifier: "t_rational_86400_by_1",
							typeString: "int_const 86400"
						},
						value: "86400"
					},
					visibility: "internal"
				},
				{
					constant: false,
					id: 788,
					name: "gsnCounter",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "1094:45:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_mapping$_t_uint256_$_t_uint256_$",
						typeString: "mapping(uint256 => uint256)"
					},
					typeName: {
						id: 787,
						keyType: {
							id: 785,
							name: "uint256",
							nodeType: "ElementaryTypeName",
							src: "1102:7:1",
							typeDescriptions: {
								typeIdentifier: "t_uint256",
								typeString: "uint256"
							}
						},
						nodeType: "Mapping",
						src: "1094:27:1",
						typeDescriptions: {
							typeIdentifier: "t_mapping$_t_uint256_$_t_uint256_$",
							typeString: "mapping(uint256 => uint256)"
						},
						valueType: {
							id: 786,
							name: "uint256",
							nodeType: "ElementaryTypeName",
							src: "1113:7:1",
							typeDescriptions: {
								typeIdentifier: "t_uint256",
								typeString: "uint256"
							}
						}
					},
					value: null,
					visibility: "public"
				},
				{
					constant: false,
					id: 790,
					name: "gsnMaxCallsPerDay",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "1198:31:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_uint40",
						typeString: "uint40"
					},
					typeName: {
						id: 789,
						name: "uint40",
						nodeType: "ElementaryTypeName",
						src: "1198:6:1",
						typeDescriptions: {
							typeIdentifier: "t_uint40",
							typeString: "uint40"
						}
					},
					value: null,
					visibility: "public"
				},
				{
					id: 793,
					libraryName: {
						contractScope: null,
						id: 791,
						name: "PolymorphicDictionaryLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 8526,
						src: "1242:24:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_PolymorphicDictionaryLib_$8526",
							typeString: "library PolymorphicDictionaryLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1236:82:1",
					typeName: {
						contractScope: null,
						id: 792,
						name: "PolymorphicDictionaryLib.PolymorphicDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 7030,
						src: "1271:46:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage_ptr",
							typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
						}
					}
				},
				{
					id: 796,
					libraryName: {
						contractScope: null,
						id: 794,
						name: "Bytes32SetDictionaryLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 6086,
						src: "1329:23:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_Bytes32SetDictionaryLib_$6086",
							typeString: "library Bytes32SetDictionaryLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1323:79:1",
					typeName: {
						contractScope: null,
						id: 795,
						name: "Bytes32SetDictionaryLib.Bytes32SetDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 5790,
						src: "1357:44:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage_ptr",
							typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
						}
					}
				},
				{
					constant: false,
					id: 800,
					name: "_table",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "1660:43:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
						typeString: "mapping(bytes32 => bytes32)"
					},
					typeName: {
						id: 799,
						keyType: {
							id: 797,
							name: "bytes32",
							nodeType: "ElementaryTypeName",
							src: "1668:7:1",
							typeDescriptions: {
								typeIdentifier: "t_bytes32",
								typeString: "bytes32"
							}
						},
						nodeType: "Mapping",
						src: "1660:27:1",
						typeDescriptions: {
							typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
							typeString: "mapping(bytes32 => bytes32)"
						},
						valueType: {
							id: 798,
							name: "bytes32",
							nodeType: "ElementaryTypeName",
							src: "1679:7:1",
							typeDescriptions: {
								typeIdentifier: "t_bytes32",
								typeString: "bytes32"
							}
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					constant: false,
					id: 802,
					name: "tableId",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "1796:61:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
						typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
					},
					typeName: {
						contractScope: null,
						id: 801,
						name: "Bytes32SetDictionaryLib.Bytes32SetDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 5790,
						src: "1796:44:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage_ptr",
							typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					id: 805,
					libraryName: {
						contractScope: null,
						id: 803,
						name: "TableLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10533,
						src: "1953:8:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_TableLib_$10533",
							typeString: "library TableLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1947:34:1",
					typeName: {
						contractScope: null,
						id: 804,
						name: "TableLib.Table",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10298,
						src: "1966:14:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Table_$10298_storage_ptr",
							typeString: "struct TableLib.Table"
						}
					}
				},
				{
					id: 808,
					libraryName: {
						contractScope: null,
						id: 806,
						name: "TableLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10533,
						src: "1992:8:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_TableLib_$10533",
							typeString: "library TableLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1986:25:1",
					typeName: {
						id: 807,
						name: "bytes",
						nodeType: "ElementaryTypeName",
						src: "2005:5:1",
						typeDescriptions: {
							typeIdentifier: "t_bytes_storage_ptr",
							typeString: "bytes"
						}
					}
				},
				{
					constant: true,
					id: 811,
					name: "schemasTables",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "2173:106:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_bytes32",
						typeString: "bytes32"
					},
					typeName: {
						id: 809,
						name: "bytes32",
						nodeType: "ElementaryTypeName",
						src: "2173:7:1",
						typeDescriptions: {
							typeIdentifier: "t_bytes32",
							typeString: "bytes32"
						}
					},
					value: {
						argumentTypes: null,
						hexValue: "307837333633363836353664363137333265373037353632366336393633326537343631363236633635373330303030303030303030303030303030303030303030",
						id: 810,
						isConstant: false,
						isLValue: false,
						isPure: true,
						kind: "number",
						lValueRequested: false,
						nodeType: "Literal",
						src: "2213:66:1",
						subdenomination: null,
						typeDescriptions: {
							typeIdentifier: "t_rational_52191615962582502679176554766158760808305166966340223837583177329853989912576_by_1",
							typeString: "int_const 5219...(69 digits omitted)...2576"
						},
						value: "0x736368656d61732e7075626c69632e7461626c65730000000000000000000000"
					},
					visibility: "public"
				},
				{
					constant: false,
					id: 813,
					name: "database",
					nodeType: "VariableDeclaration",
					scope: 2048,
					src: "2554:64:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
						typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
					},
					typeName: {
						contractScope: null,
						id: 812,
						name: "PolymorphicDictionaryLib.PolymorphicDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 7030,
						src: "2554:46:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage_ptr",
							typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					body: {
						id: 836,
						nodeType: "Block",
						src: "2786:123:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											expression: {
												argumentTypes: null,
												id: 823,
												name: "msg",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 10548,
												src: "2818:3:1",
												typeDescriptions: {
													typeIdentifier: "t_magic_message",
													typeString: "msg"
												}
											},
											id: 824,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											memberName: "sender",
											nodeType: "MemberAccess",
											referencedDeclaration: null,
											src: "2818:10:1",
											typeDescriptions: {
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										],
										expression: {
											argumentTypes: null,
											id: 820,
											name: "OwnableELA",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 4616,
											src: "2796:10:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_OwnableELA_$4616_$",
												typeString: "type(contract OwnableELA)"
											}
										},
										id: 822,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "initialize",
										nodeType: "MemberAccess",
										referencedDeclaration: 4527,
										src: "2796:21:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_address_$returns$__$",
											typeString: "function (address)"
										}
									},
									id: 825,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "2796:33:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 826,
								nodeType: "ExpressionStatement",
								src: "2796:33:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 830,
											name: "relayHubAddr",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 815,
											src: "2866:12:1",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_address",
												typeString: "address"
											}
										],
										expression: {
											argumentTypes: null,
											id: 827,
											name: "GSNRecipientELA",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 3295,
											src: "2839:15:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_GSNRecipientELA_$3295_$",
												typeString: "type(contract GSNRecipientELA)"
											}
										},
										id: 829,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "initialize",
										nodeType: "MemberAccess",
										referencedDeclaration: 3258,
										src: "2839:26:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_address_$returns$__$",
											typeString: "function (address)"
										}
									},
									id: 831,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "2839:40:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 832,
								nodeType: "ExpressionStatement",
								src: "2839:40:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 833,
										name: "_initialize",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 856,
										src: "2889:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 834,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "2889:13:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 835,
								nodeType: "ExpressionStatement",
								src: "2889:13:1"
							}
						]
					},
					documentation: null,
					id: 837,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 818,
							modifierName: {
								argumentTypes: null,
								id: 817,
								name: "initializer",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4467,
								src: "2774:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "2774:11:1"
						}
					],
					name: "initialize",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 816,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 815,
								name: "relayHubAddr",
								nodeType: "VariableDeclaration",
								scope: 837,
								src: "2745:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 814,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "2745:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "2744:22:1"
					},
					returnParameters: {
						id: 819,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "2786:0:1"
					},
					scope: 2048,
					src: "2725:184:1",
					stateMutability: "nonpayable",
					superFunction: 3258,
					visibility: "public"
				},
				{
					body: {
						id: 855,
						nodeType: "Block",
						src: "2947:255:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 844,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 840,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 790,
										src: "2957:17:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												hexValue: "31303030",
												id: 842,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "2984:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_1000_by_1",
													typeString: "int_const 1000"
												},
												value: "1000"
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_rational_1000_by_1",
													typeString: "int_const 1000"
												}
											],
											id: 841,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "2977:6:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_uint40_$",
												typeString: "type(uint40)"
											},
											typeName: "uint40"
										},
										id: 843,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "2977:12:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									src: "2957:32:1",
									typeDescriptions: {
										typeIdentifier: "t_uint40",
										typeString: "uint40"
									}
								},
								id: 845,
								nodeType: "ExpressionStatement",
								src: "2957:32:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 849,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 811,
											src: "3125:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											expression: {
												argumentTypes: null,
												expression: {
													argumentTypes: null,
													id: 850,
													name: "PolymorphicDictionaryLib",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 8526,
													src: "3140:24:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_contract$_PolymorphicDictionaryLib_$8526_$",
														typeString: "type(library PolymorphicDictionaryLib)"
													}
												},
												id: 851,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												memberName: "DictionaryType",
												nodeType: "MemberAccess",
												referencedDeclaration: 7035,
												src: "3140:39:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_enum$_DictionaryType_$7035_$",
													typeString: "type(enum PolymorphicDictionaryLib.DictionaryType)"
												}
											},
											id: 852,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											memberName: "OneToManyFixed",
											nodeType: "MemberAccess",
											referencedDeclaration: null,
											src: "3140:54:1",
											typeDescriptions: {
												typeIdentifier: "t_enum$_DictionaryType_$7035",
												typeString: "enum PolymorphicDictionaryLib.DictionaryType"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_enum$_DictionaryType_$7035",
												typeString: "enum PolymorphicDictionaryLib.DictionaryType"
											}
										],
										expression: {
											argumentTypes: null,
											id: 846,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "3109:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 848,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8453,
										src: "3109:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_enum$_DictionaryType_$7035_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,enum PolymorphicDictionaryLib.DictionaryType) returns (bool)"
										}
									},
									id: 853,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "3109:86:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 854,
								nodeType: "ExpressionStatement",
								src: "3109:86:1"
							}
						]
					},
					documentation: null,
					id: 856,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_initialize",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 838,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "2935:2:1"
					},
					returnParameters: {
						id: 839,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "2947:0:1"
					},
					scope: 2048,
					src: "2915:287:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 914,
						nodeType: "Block",
						src: "3719:763:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											id: 878,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												baseExpression: {
													argumentTypes: null,
													id: 874,
													name: "_table",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 800,
													src: "4013:6:1",
													typeDescriptions: {
														typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
														typeString: "mapping(bytes32 => bytes32)"
													}
												},
												id: 876,
												indexExpression: {
													argumentTypes: null,
													id: 875,
													name: "tableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 860,
													src: "4020:8:1",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												},
												isConstant: false,
												isLValue: true,
												isPure: false,
												lValueRequested: false,
												nodeType: "IndexAccess",
												src: "4013:16:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "30",
												id: 877,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "4033:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "4013:21:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "5461626c6520616c726561647920657869737473",
											id: 879,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "4036:22:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_d8add126c0ed6d6d0798bb02d3c7c3567f9ff0247b5ed07dd21088b6700efbaf",
												typeString: "literal_string \"Table already exists\""
											},
											value: "Table already exists"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_d8add126c0ed6d6d0798bb02d3c7c3567f9ff0247b5ed07dd21088b6700efbaf",
												typeString: "literal_string \"Table already exists\""
											}
										],
										id: 873,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "4005:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 880,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4005:54:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 881,
								nodeType: "ExpressionStatement",
								src: "4005:54:1"
							},
							{
								assignments: [
									883
								],
								declarations: [
									{
										constant: false,
										id: 883,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 914,
										src: "4070:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 882,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "4070:7:1",
											stateMutability: "nonpayable",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 887,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											hexValue: "307830",
											id: 885,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "4097:3:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_0_by_1",
												typeString: "int_const 0"
											},
											value: "0x0"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_rational_0_by_1",
												typeString: "int_const 0"
											}
										],
										id: 884,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "4089:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_address_$",
											typeString: "type(address)"
										},
										typeName: "address"
									},
									id: 886,
									isConstant: false,
									isLValue: false,
									isPure: true,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4089:12:1",
									typeDescriptions: {
										typeIdentifier: "t_address_payable",
										typeString: "address payable"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "4070:31:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 889,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 860,
											src: "4180:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 890,
											name: "permission",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 862,
											src: "4190:10:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										{
											argumentTypes: null,
											id: 891,
											name: "delegate",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 883,
											src: "4202:8:1",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											},
											{
												typeIdentifier: "t_address",
												typeString: "address"
											}
										],
										id: 888,
										name: "setTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1840,
										src: "4163:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_uint8_$_t_address_$returns$__$",
											typeString: "function (bytes32,uint8,address)"
										}
									},
									id: 892,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4163:48:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 893,
								nodeType: "ExpressionStatement",
								src: "4163:48:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 897,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 811,
											src: "4246:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 898,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 858,
											src: "4261:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 894,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "4222:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 896,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8192,
										src: "4222:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 899,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4222:49:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 900,
								nodeType: "ExpressionStatement",
								src: "4222:49:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 904,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 860,
											src: "4366:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 901,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "4351:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 903,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5806,
										src: "4351:14:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 905,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4351:24:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 906,
								nodeType: "ExpressionStatement",
								src: "4351:24:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 908,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 858,
											src: "4430:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 909,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 860,
											src: "4441:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 910,
											name: "columnName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 865,
											src: "4451:10:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										},
										{
											argumentTypes: null,
											id: 911,
											name: "columnDtype",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 868,
											src: "4463:11:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											},
											{
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										],
										id: 907,
										name: "saveSchema",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 997,
										src: "4419:10:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_array$_t_bytes32_$dyn_memory_ptr_$_t_array$_t_bytes32_$dyn_memory_ptr_$returns$_t_bool_$",
											typeString: "function (bytes32,bytes32,bytes32[] memory,bytes32[] memory) returns (bool)"
										}
									},
									id: 912,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4419:56:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 913,
								nodeType: "ExpressionStatement",
								src: "4419:56:1"
							}
						]
					},
					documentation: "@dev create a new table, only the owner may create this\n     * @param tableName right padded zeroes (Web3.utils.stringToHex)\n@param tableKey this is the namehash of tableName",
					id: 915,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 871,
							modifierName: {
								argumentTypes: null,
								id: 870,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "3709:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "3709:9:1"
						}
					],
					name: "createTable",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 869,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 858,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 915,
								src: "3550:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 857,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "3550:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 860,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 915,
								src: "3577:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 859,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "3577:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 862,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 915,
								src: "3603:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 861,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "3603:5:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 865,
								name: "columnName",
								nodeType: "VariableDeclaration",
								scope: 915,
								src: "3629:27:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 863,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "3629:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 864,
									length: null,
									nodeType: "ArrayTypeName",
									src: "3629:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 868,
								name: "columnDtype",
								nodeType: "VariableDeclaration",
								scope: 915,
								src: "3666:28:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 866,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "3666:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 867,
									length: null,
									nodeType: "ArrayTypeName",
									src: "3666:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "3540:161:1"
					},
					returnParameters: {
						id: 872,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "3719:0:1"
					},
					scope: 2048,
					src: "3520:962:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 943,
						nodeType: "Block",
						src: "4618:136:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 928,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 924,
											name: "_table",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 800,
											src: "4628:6:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
												typeString: "mapping(bytes32 => bytes32)"
											}
										},
										id: 926,
										indexExpression: {
											argumentTypes: null,
											id: 925,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 919,
											src: "4635:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: true,
										nodeType: "IndexAccess",
										src: "4628:16:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										hexValue: "30",
										id: 927,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "4647:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_0_by_1",
											typeString: "int_const 0"
										},
										value: "0"
									},
									src: "4628:20:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								id: 929,
								nodeType: "ExpressionStatement",
								src: "4628:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 933,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 811,
											src: "4685:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 934,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 917,
											src: "4700:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 930,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "4658:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 932,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8506,
										src: "4658:26:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 935,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4658:52:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 936,
								nodeType: "ExpressionStatement",
								src: "4658:52:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 940,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 919,
											src: "4738:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 937,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "4720:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 939,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5919,
										src: "4720:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 941,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4720:27:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 942,
								nodeType: "ExpressionStatement",
								src: "4720:27:1"
							}
						]
					},
					documentation: null,
					id: 944,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 922,
							modifierName: {
								argumentTypes: null,
								id: 921,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "4608:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "4608:9:1"
						}
					],
					name: "deleteTable",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 920,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 917,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 944,
								src: "4551:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 916,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "4551:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 919,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 944,
								src: "4578:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 918,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "4578:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "4541:59:1"
					},
					returnParameters: {
						id: 923,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "4618:0:1"
					},
					scope: 2048,
					src: "4521:233:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 955,
						nodeType: "Block",
						src: "4821:77:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 952,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 811,
											src: "4877:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 950,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "4838:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 951,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "enumerateForKeyOneToManyFixed",
										nodeType: "MemberAccess",
										referencedDeclaration: 7287,
										src: "4838:38:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_array$_t_bytes32_$dyn_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32[] memory)"
										}
									},
									id: 953,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4838:53:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
										typeString: "bytes32[] memory"
									}
								},
								functionReturnParameters: 949,
								id: 954,
								nodeType: "Return",
								src: "4831:60:1"
							}
						]
					},
					documentation: null,
					id: 956,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTables",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 945,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "4778:2:1"
					},
					returnParameters: {
						id: 949,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 948,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 956,
								src: "4804:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 946,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "4804:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 947,
									length: null,
									nodeType: "ArrayTypeName",
									src: "4804:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "4803:18:1"
					},
					scope: 2048,
					src: "4760:138:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 996,
						nodeType: "Block",
						src: "5230:331:1",
						statements: [
							{
								assignments: [
									976
								],
								declarations: [
									{
										constant: false,
										id: 976,
										name: "tableSchema",
										nodeType: "VariableDeclaration",
										scope: 996,
										src: "5241:33:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_struct$_Table_$10298_memory_ptr",
											typeString: "struct TableLib.Table"
										},
										typeName: {
											contractScope: null,
											id: 975,
											name: "TableLib.Table",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 10298,
											src: "5241:14:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Table_$10298_storage_ptr",
												typeString: "struct TableLib.Table"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 983,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 979,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 958,
											src: "5306:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 980,
											name: "columnName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 963,
											src: "5329:10:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										},
										{
											argumentTypes: null,
											id: 981,
											name: "columnDtype",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 966,
											src: "5353:11:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											},
											{
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										],
										expression: {
											argumentTypes: null,
											id: 977,
											name: "TableLib",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10533,
											src: "5277:8:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_TableLib_$10533_$",
												typeString: "type(library TableLib)"
											}
										},
										id: 978,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "create",
										nodeType: "MemberAccess",
										referencedDeclaration: 10398,
										src: "5277:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_array$_t_bytes32_$dyn_memory_ptr_$_t_array$_t_bytes32_$dyn_memory_ptr_$returns$_t_struct$_Table_$10298_memory_ptr_$",
											typeString: "function (bytes32,bytes32[] memory,bytes32[] memory) pure returns (struct TableLib.Table memory)"
										}
									},
									id: 982,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5277:97:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10298_memory_ptr",
										typeString: "struct TableLib.Table memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5241:133:1"
							},
							{
								assignments: [
									985
								],
								declarations: [
									{
										constant: false,
										id: 985,
										name: "encoded",
										nodeType: "VariableDeclaration",
										scope: 996,
										src: "5385:20:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 984,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "5385:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 989,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										expression: {
											argumentTypes: null,
											id: 986,
											name: "tableSchema",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 976,
											src: "5408:11:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Table_$10298_memory_ptr",
												typeString: "struct TableLib.Table memory"
											}
										},
										id: 987,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "encode",
										nodeType: "MemberAccess",
										referencedDeclaration: 10450,
										src: "5408:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_struct$_Table_$10298_memory_ptr_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_Table_$10298_memory_ptr_$",
											typeString: "function (struct TableLib.Table memory) pure returns (bytes memory)"
										}
									},
									id: 988,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5408:20:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory_ptr",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5385:43:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 992,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 960,
											src: "5536:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 993,
											name: "encoded",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 985,
											src: "5546:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										],
										expression: {
											argumentTypes: null,
											id: 990,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "5512:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 991,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8143,
										src: "5512:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes_memory_ptr_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes memory) returns (bool)"
										}
									},
									id: 994,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5512:42:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 972,
								id: 995,
								nodeType: "Return",
								src: "5505:49:1"
							}
						]
					},
					documentation: null,
					id: 997,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 969,
							modifierName: {
								argumentTypes: null,
								id: 968,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "5205:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "5205:9:1"
						}
					],
					name: "saveSchema",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 967,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 958,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 997,
								src: "5072:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 957,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5072:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 960,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 997,
								src: "5099:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 959,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5099:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 963,
								name: "columnName",
								nodeType: "VariableDeclaration",
								scope: 997,
								src: "5125:27:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 961,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "5125:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 962,
									length: null,
									nodeType: "ArrayTypeName",
									src: "5125:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 966,
								name: "columnDtype",
								nodeType: "VariableDeclaration",
								scope: 997,
								src: "5162:28:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 964,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "5162:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 965,
									length: null,
									nodeType: "ArrayTypeName",
									src: "5162:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5062:135:1"
					},
					returnParameters: {
						id: 972,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 971,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 997,
								src: "5224:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 970,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "5224:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5223:6:1"
					},
					scope: 2048,
					src: "5043:518:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1015,
						nodeType: "Block",
						src: "5665:108:1",
						statements: [
							{
								assignments: [
									1005
								],
								declarations: [
									{
										constant: false,
										id: 1005,
										name: "encoded",
										nodeType: "VariableDeclaration",
										scope: 1015,
										src: "5675:20:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 1004,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "5675:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1010,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1008,
											name: "_name",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 999,
											src: "5722:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1006,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "5698:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1007,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "getBytesForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7603,
										src: "5698:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes memory)"
										}
									},
									id: 1009,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5698:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory_ptr",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5675:53:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										expression: {
											argumentTypes: null,
											id: 1011,
											name: "encoded",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1005,
											src: "5745:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										},
										id: 1012,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "decodeTable",
										nodeType: "MemberAccess",
										referencedDeclaration: 10499,
										src: "5745:19:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes_memory_ptr_$returns$_t_struct$_Table_$10298_memory_ptr_$bound_to$_t_bytes_memory_ptr_$",
											typeString: "function (bytes memory) pure returns (struct TableLib.Table memory)"
										}
									},
									id: 1013,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5745:21:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10298_memory_ptr",
										typeString: "struct TableLib.Table memory"
									}
								},
								functionReturnParameters: 1003,
								id: 1014,
								nodeType: "Return",
								src: "5738:28:1"
							}
						]
					},
					documentation: null,
					id: 1016,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getSchema",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1000,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 999,
								name: "_name",
								nodeType: "VariableDeclaration",
								scope: 1016,
								src: "5606:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 998,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5606:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5605:15:1"
					},
					returnParameters: {
						id: 1003,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1002,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1016,
								src: "5642:21:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_struct$_Table_$10298_memory_ptr",
									typeString: "struct TableLib.Table"
								},
								typeName: {
									contractScope: null,
									id: 1001,
									name: "TableLib.Table",
									nodeType: "UserDefinedTypeName",
									referencedDeclaration: 10298,
									src: "5642:14:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10298_storage_ptr",
										typeString: "struct TableLib.Table"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5641:23:1"
					},
					scope: 2048,
					src: "5587:186:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1053,
						nodeType: "Block",
						src: "5975:423:1",
						statements: [
							{
								assignments: [
									1021,
									1023
								],
								declarations: [
									{
										constant: false,
										id: 1021,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1053,
										src: "5987:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1020,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "5987:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									},
									{
										constant: false,
										id: 1023,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1053,
										src: "6007:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1022,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "6007:7:1",
											stateMutability: "nonpayable",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1027,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1025,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1018,
											src: "6044:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1024,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1805,
										src: "6027:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1026,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6027:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5986:67:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											id: 1031,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1029,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1021,
												src: "6136:10:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											},
											nodeType: "BinaryOperation",
											operator: ">",
											rightExpression: {
												argumentTypes: null,
												hexValue: "30",
												id: 1030,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "6149:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "6136:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65",
											id: 1032,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "6152:33:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_28f57c2279a5e7e2e4199177afe179a3b463277cc9c606809c6534b86aa50229",
												typeString: "literal_string \"Cannot INSERT into system table\""
											},
											value: "Cannot INSERT into system table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_28f57c2279a5e7e2e4199177afe179a3b463277cc9c606809c6534b86aa50229",
												typeString: "literal_string \"Cannot INSERT into system table\""
											}
										],
										id: 1028,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "6128:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1033,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6128:58:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1034,
								nodeType: "ExpressionStatement",
								src: "6128:58:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1048,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												id: 1043,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													},
													id: 1038,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1036,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1021,
														src: "6265:10:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													},
													nodeType: "BinaryOperation",
													operator: ">",
													rightExpression: {
														argumentTypes: null,
														hexValue: "31",
														id: 1037,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "6278:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "6265:14:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												nodeType: "BinaryOperation",
												operator: "||",
												rightExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													},
													id: 1042,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														"arguments": [
														],
														expression: {
															argumentTypes: [
															],
															id: 1039,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4556,
															src: "6283:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1040,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "6283:9:1",
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														}
													},
													nodeType: "BinaryOperation",
													operator: "==",
													rightExpression: {
														argumentTypes: null,
														hexValue: "74727565",
														id: 1041,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "6296:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "6283:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "6265:35:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "||",
											rightExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_address",
													typeString: "address"
												},
												id: 1047,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1044,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1023,
													src: "6304:8:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												nodeType: "BinaryOperation",
												operator: "==",
												rightExpression: {
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1045,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3144
														],
														referencedDeclaration: 3144,
														src: "6316:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1046,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "6316:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "6304:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "6265:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e20494e5345525420696e746f2074686973207461626c65",
											id: 1049,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "6330:48:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_8da29dab96b947ba0a45fbb38f71b63a9c8bd8e01000bc5ea24df01471fecc83",
												typeString: "literal_string \"Only owner/delegate can INSERT into this table\""
											},
											value: "Only owner/delegate can INSERT into this table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_8da29dab96b947ba0a45fbb38f71b63a9c8bd8e01000bc5ea24df01471fecc83",
												typeString: "literal_string \"Only owner/delegate can INSERT into this table\""
											}
										],
										id: 1035,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "6257:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1050,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6257:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1051,
								nodeType: "ExpressionStatement",
								src: "6257:122:1"
							},
							{
								id: 1052,
								nodeType: "PlaceholderStatement",
								src: "6390:1:1"
							}
						]
					},
					documentation: "@dev Table level permission checks",
					id: 1054,
					name: "insertCheck",
					nodeType: "ModifierDefinition",
					parameters: {
						id: 1019,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1018,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1054,
								src: "5957:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1017,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5957:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5956:18:1"
					},
					src: "5936:462:1",
					visibility: "internal"
				},
				{
					anonymous: false,
					documentation: "Primarily exists to assist in query WHERE searches, therefore we\nwant the index to exist on the value and table, filtering on owner\nis important for performance",
					id: 1066,
					name: "InsertVal",
					nodeType: "EventDefinition",
					parameters: {
						id: 1065,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1056,
								indexed: true,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1066,
								src: "6629:24:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1055,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6629:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1058,
								indexed: true,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1066,
								src: "6663:24:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1057,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6663:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1060,
								indexed: true,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1066,
								src: "6697:19:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1059,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6697:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1062,
								indexed: false,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1066,
								src: "6727:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1061,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6727:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1064,
								indexed: false,
								name: "owner",
								nodeType: "VariableDeclaration",
								scope: 1066,
								src: "6748:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1063,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "6748:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "6619:148:1"
					},
					src: "6603:165:1"
				},
				{
					body: {
						id: 1148,
						nodeType: "Block",
						src: "7263:1015:1",
						statements: [
							{
								assignments: [
									1083
								],
								declarations: [
									{
										constant: false,
										id: 1083,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1148,
										src: "7274:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1082,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "7274:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1088,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1085,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1070,
											src: "7304:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1086,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1068,
											src: "7311:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1084,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "7295:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1087,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7295:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "7274:46:1"
							},
							{
								assignments: [
									1090
								],
								declarations: [
									{
										constant: false,
										id: 1090,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1148,
										src: "7330:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1089,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "7330:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1095,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1092,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1072,
											src: "7365:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1093,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1083,
											src: "7375:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1091,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "7356:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1094,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7356:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "7330:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1102,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1099,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1090,
														src: "7426:15:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1097,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "7405:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1098,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7338,
													src: "7405:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
													}
												},
												id: 1100,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "7405:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "66616c7365",
												id: 1101,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "7446:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "7405:46:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "69642b6669656c6420616c726561647920657869737473",
											id: 1103,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "7453:25:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_b47ab3ca8e2817377098c0fdb9f676216babd1393ec4fa6b120ecb6719d9fd66",
												typeString: "literal_string \"id+field already exists\""
											},
											value: "id+field already exists"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_b47ab3ca8e2817377098c0fdb9f676216babd1393ec4fa6b120ecb6719d9fd66",
												typeString: "literal_string \"id+field already exists\""
											}
										],
										id: 1096,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "7397:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1104,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7397:82:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1105,
								nodeType: "ExpressionStatement",
								src: "7397:82:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1106,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1930,
										src: "7519:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1107,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7519:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1108,
								nodeType: "ExpressionStatement",
								src: "7519:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1112,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1068,
											src: "7741:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1113,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1074,
											src: "7751:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1109,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "7718:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1111,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5894,
										src: "7718:22:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1114,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7718:36:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1115,
								nodeType: "ExpressionStatement",
								src: "7718:36:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									},
									id: 1121,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1118,
												name: "idTableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1083,
												src: "7901:10:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											],
											expression: {
												argumentTypes: null,
												id: 1116,
												name: "database",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 813,
												src: "7880:8:1",
												typeDescriptions: {
													typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
													typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
												}
											},
											id: 1117,
											isConstant: false,
											isLValue: true,
											isPure: false,
											lValueRequested: false,
											memberName: "containsKey",
											nodeType: "MemberAccess",
											referencedDeclaration: 7338,
											src: "7880:20:1",
											typeDescriptions: {
												typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
												typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
											}
										},
										id: 1119,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "functionCall",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "7880:32:1",
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										}
									},
									nodeType: "BinaryOperation",
									operator: "==",
									rightExpression: {
										argumentTypes: null,
										hexValue: "66616c7365",
										id: 1120,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "bool",
										lValueRequested: false,
										nodeType: "Literal",
										src: "7916:5:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										value: "false"
									},
									src: "7880:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1129,
								nodeType: "IfStatement",
								src: "7876:109:1",
								trueBody: {
									id: 1128,
									nodeType: "Block",
									src: "7922:63:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1123,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1083,
														src: "7949:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1124,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1074,
														src: "7961:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1125,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1068,
														src: "7965:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													id: 1122,
													name: "_setRowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1267,
													src: "7936:12:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
														typeString: "function (bytes32,bytes32,bytes32)"
													}
												},
												id: 1126,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "7936:38:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$__$",
													typeString: "tuple()"
												}
											},
											id: 1127,
											nodeType: "ExpressionStatement",
											src: "7936:38:1"
										}
									]
								}
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1133,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1090,
											src: "8126:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1135,
													name: "val",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1076,
													src: "8151:3:1",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												],
												id: 1134,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "8143:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1136,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "8143:12:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1130,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "8102:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1132,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7996,
										src: "8102:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1137,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8102:54:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1138,
								nodeType: "ExpressionStatement",
								src: "8102:54:1"
							},
							{
								eventCall: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1140,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1068,
											src: "8228:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1141,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1072,
											src: "8238:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1142,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1076,
											src: "8248:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1143,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1074,
											src: "8253:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											"arguments": [
											],
											expression: {
												argumentTypes: [
												],
												id: 1144,
												name: "_msgSender",
												nodeType: "Identifier",
												overloadedDeclarations: [
													3144
												],
												referencedDeclaration: 3144,
												src: "8257:10:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 1145,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "8257:12:1",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_address",
												typeString: "address"
											}
										],
										id: 1139,
										name: "InsertVal",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1066,
										src: "8218:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_event_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_address_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32,address)"
										}
									},
									id: 1146,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8218:52:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1147,
								nodeType: "EmitStatement",
								src: "8213:57:1"
							}
						]
					},
					documentation: "@dev Prior to insert, we check the permissions and autoIncrement\nTODO: use the schema and determine the proper type of data to insert\n     * @param tableKey the namehashed [table] name string\n@param idKey the sha3 hashed idKey\n@param id as the raw string (unhashed)",
					id: 1149,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": [
								{
									argumentTypes: null,
									id: 1079,
									name: "tableKey",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1068,
									src: "7254:8:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								}
							],
							id: 1080,
							modifierName: {
								argumentTypes: null,
								id: 1078,
								name: "insertCheck",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 1054,
								src: "7242:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$_t_bytes32_$",
									typeString: "modifier (bytes32)"
								}
							},
							nodeType: "ModifierInvocation",
							src: "7242:21:1"
						}
					],
					name: "insertVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1077,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1068,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1149,
								src: "7121:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1067,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7121:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1070,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1149,
								src: "7147:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1069,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7147:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1072,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1149,
								src: "7170:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1071,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7170:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1074,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1149,
								src: "7197:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1073,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7197:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1076,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1149,
								src: "7217:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1075,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7217:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "7110:119:1"
					},
					returnParameters: {
						id: 1081,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "7263:0:1"
					},
					scope: 2048,
					src: "7092:1186:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1220,
						nodeType: "Block",
						src: "8462:713:1",
						statements: [
							{
								assignments: [
									1166
								],
								declarations: [
									{
										constant: false,
										id: 1166,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1220,
										src: "8473:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1165,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "8473:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1171,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1168,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1153,
											src: "8503:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1169,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1151,
											src: "8510:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1167,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "8494:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1170,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8494:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "8473:46:1"
							},
							{
								assignments: [
									1173
								],
								declarations: [
									{
										constant: false,
										id: 1173,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1220,
										src: "8529:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1172,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "8529:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1178,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1175,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1155,
											src: "8564:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1176,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1166,
											src: "8574:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1174,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "8555:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1177,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8555:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "8529:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1185,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1182,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1173,
														src: "8625:15:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1180,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "8604:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1181,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7338,
													src: "8604:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
													}
												},
												id: 1183,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "8604:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "66616c7365",
												id: 1184,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "8645:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "8604:46:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "69642b6669656c6420616c726561647920657869737473",
											id: 1186,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "8652:25:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_b47ab3ca8e2817377098c0fdb9f676216babd1393ec4fa6b120ecb6719d9fd66",
												typeString: "literal_string \"id+field already exists\""
											},
											value: "id+field already exists"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_b47ab3ca8e2817377098c0fdb9f676216babd1393ec4fa6b120ecb6719d9fd66",
												typeString: "literal_string \"id+field already exists\""
											}
										],
										id: 1179,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "8596:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1187,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8596:82:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1188,
								nodeType: "ExpressionStatement",
								src: "8596:82:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1189,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1930,
										src: "8718:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1190,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8718:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1191,
								nodeType: "ExpressionStatement",
								src: "8718:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1195,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1151,
											src: "8837:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1196,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1157,
											src: "8847:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1192,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "8814:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1194,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5894,
										src: "8814:22:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1197,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8814:36:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1198,
								nodeType: "ExpressionStatement",
								src: "8814:36:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									},
									id: 1204,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1201,
												name: "idTableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1166,
												src: "8997:10:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											],
											expression: {
												argumentTypes: null,
												id: 1199,
												name: "database",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 813,
												src: "8976:8:1",
												typeDescriptions: {
													typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
													typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
												}
											},
											id: 1200,
											isConstant: false,
											isLValue: true,
											isPure: false,
											lValueRequested: false,
											memberName: "containsKey",
											nodeType: "MemberAccess",
											referencedDeclaration: 7338,
											src: "8976:20:1",
											typeDescriptions: {
												typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
												typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
											}
										},
										id: 1202,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "functionCall",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "8976:32:1",
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										}
									},
									nodeType: "BinaryOperation",
									operator: "==",
									rightExpression: {
										argumentTypes: null,
										hexValue: "66616c7365",
										id: 1203,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "bool",
										lValueRequested: false,
										nodeType: "Literal",
										src: "9012:5:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										value: "false"
									},
									src: "8976:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1212,
								nodeType: "IfStatement",
								src: "8972:109:1",
								trueBody: {
									id: 1211,
									nodeType: "Block",
									src: "9018:63:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1206,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1166,
														src: "9045:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1207,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1157,
														src: "9057:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1208,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1151,
														src: "9061:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													id: 1205,
													name: "_setRowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1267,
													src: "9032:12:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
														typeString: "function (bytes32,bytes32,bytes32)"
													}
												},
												id: 1209,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "9032:38:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$__$",
													typeString: "tuple()"
												}
											},
											id: 1210,
											nodeType: "ExpressionStatement",
											src: "9032:38:1"
										}
									]
								}
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1216,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1173,
											src: "9147:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1217,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1159,
											src: "9164:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1213,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "9123:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1215,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8143,
										src: "9123:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes_memory_ptr_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes memory) returns (bool)"
										}
									},
									id: 1218,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9123:45:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1219,
								nodeType: "ExpressionStatement",
								src: "9123:45:1"
							}
						]
					},
					documentation: null,
					id: 1221,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": [
								{
									argumentTypes: null,
									id: 1162,
									name: "tableKey",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1151,
									src: "8453:8:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								}
							],
							id: 1163,
							modifierName: {
								argumentTypes: null,
								id: 1161,
								name: "insertCheck",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 1054,
								src: "8441:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$_t_bytes32_$",
									typeString: "modifier (bytes32)"
								}
							},
							nodeType: "ModifierInvocation",
							src: "8441:21:1"
						}
					],
					name: "insertValVar",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1160,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1151,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1221,
								src: "8315:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1150,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8315:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1153,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1221,
								src: "8341:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1152,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8341:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1155,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1221,
								src: "8364:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1154,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8364:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1157,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1221,
								src: "8391:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1156,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8391:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1159,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1221,
								src: "8411:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1158,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "8411:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "8305:123:1"
					},
					returnParameters: {
						id: 1164,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "8462:0:1"
					},
					scope: 2048,
					src: "8284:891:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1266,
						nodeType: "Block",
						src: "9387:265:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1236,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1233,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1223,
														src: "9427:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1231,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "9406:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1232,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7338,
													src: "9406:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
													}
												},
												id: 1234,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "9406:32:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "66616c7365",
												id: 1235,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "9442:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "9406:41:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "726f7720616c726561647920686173206f776e6572",
											id: 1237,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "9449:23:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_4f07436c5e922fe8ea527b1a1ba7481aa8d495ad72c7a326d88e3d9b4d6a1f59",
												typeString: "literal_string \"row already has owner\""
											},
											value: "row already has owner"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_4f07436c5e922fe8ea527b1a1ba7481aa8d495ad72c7a326d88e3d9b4d6a1f59",
												typeString: "literal_string \"row already has owner\""
											}
										],
										id: 1230,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "9398:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1238,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9398:75:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1239,
								nodeType: "ExpressionStatement",
								src: "9398:75:1"
							},
							{
								assignments: [
									1241
								],
								declarations: [
									{
										constant: false,
										id: 1241,
										name: "rowMetadata",
										nodeType: "VariableDeclaration",
										scope: 1266,
										src: "9484:19:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1240,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "9484:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1247,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1244,
													name: "now",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 10550,
													src: "9521:3:1",
													typeDescriptions: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												],
												id: 1243,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "9514:6:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint32_$",
													typeString: "type(uint32)"
												},
												typeName: "uint32"
											},
											id: 1245,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "9514:11:1",
											typeDescriptions: {
												typeIdentifier: "t_uint32",
												typeString: "uint32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_uint32",
												typeString: "uint32"
											}
										],
										id: 1242,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "9506:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1246,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9506:20:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "9484:42:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1255,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1248,
										name: "rowMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1241,
										src: "9537:11:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										commonType: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										id: 1254,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1250,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3144
														],
														referencedDeclaration: 3144,
														src: "9560:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1251,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "9560:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_address",
														typeString: "address"
													}
												],
												id: 1249,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "9552:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
											},
											id: 1252,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "9552:21:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "3332",
											id: 1253,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "9575:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_32_by_1",
												typeString: "int_const 32"
											},
											value: "32"
										},
										src: "9552:25:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "9537:40:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1256,
								nodeType: "ExpressionStatement",
								src: "9537:40:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1260,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1223,
											src: "9612:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1262,
													name: "rowMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1241,
													src: "9632:11:1",
													typeDescriptions: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												],
												id: 1261,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "9624:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1263,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "9624:20:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1257,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "9588:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1259,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7996,
										src: "9588:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1264,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9588:57:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1265,
								nodeType: "ExpressionStatement",
								src: "9588:57:1"
							}
						]
					},
					documentation: "@dev we are essentially claiming this [id].[table] for the msg.sender, and setting the id createdDate",
					id: 1267,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_setRowOwner",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1228,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1223,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1267,
								src: "9328:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1222,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9328:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1225,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1267,
								src: "9348:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1224,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9348:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1227,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1267,
								src: "9360:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1226,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9360:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "9327:50:1"
					},
					returnParameters: {
						id: 1229,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "9387:0:1"
					},
					scope: 2048,
					src: "9306:346:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1301,
						nodeType: "Block",
						src: "9978:184:1",
						statements: [
							{
								assignments: [
									1277
								],
								declarations: [
									{
										constant: false,
										id: 1277,
										name: "rowMetadata",
										nodeType: "VariableDeclaration",
										scope: 1301,
										src: "9989:19:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1276,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "9989:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1284,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1281,
													name: "idTableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1269,
													src: "10045:10:1",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												],
												expression: {
													argumentTypes: null,
													id: 1279,
													name: "database",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 813,
													src: "10019:8:1",
													typeDescriptions: {
														typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
														typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
													}
												},
												id: 1280,
												isConstant: false,
												isLValue: true,
												isPure: false,
												lValueRequested: false,
												memberName: "getBytes32ForKey",
												nodeType: "MemberAccess",
												referencedDeclaration: 7511,
												src: "10019:25:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
													typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
												}
											},
											id: 1282,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10019:37:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1278,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "10011:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1283,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10011:46:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "9989:68:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1291,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1285,
										name: "createdDate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1274,
										src: "10068:11:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes4",
											typeString: "bytes4"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1288,
														name: "rowMetadata",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1277,
														src: "10096:11:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													],
													id: 1287,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "10089:6:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint32_$",
														typeString: "type(uint32)"
													},
													typeName: "uint32"
												},
												id: 1289,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "10089:19:1",
												typeDescriptions: {
													typeIdentifier: "t_uint32",
													typeString: "uint32"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint32",
													typeString: "uint32"
												}
											],
											id: 1286,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "10082:6:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_bytes4_$",
												typeString: "type(bytes4)"
											},
											typeName: "bytes4"
										},
										id: 1290,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "10082:27:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes4",
											typeString: "bytes4"
										}
									},
									src: "10068:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes4",
										typeString: "bytes4"
									}
								},
								id: 1292,
								nodeType: "ExpressionStatement",
								src: "10068:41:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1299,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1293,
										name: "rowOwner",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1272,
										src: "10119:8:1",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												},
												id: 1297,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1295,
													name: "rowMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1277,
													src: "10138:11:1",
													typeDescriptions: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												},
												nodeType: "BinaryOperation",
												operator: ">>",
												rightExpression: {
													argumentTypes: null,
													hexValue: "3332",
													id: 1296,
													isConstant: false,
													isLValue: false,
													isPure: true,
													kind: "number",
													lValueRequested: false,
													nodeType: "Literal",
													src: "10151:2:1",
													subdenomination: null,
													typeDescriptions: {
														typeIdentifier: "t_rational_32_by_1",
														typeString: "int_const 32"
													},
													value: "32"
												},
												src: "10138:15:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											],
											id: 1294,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "10130:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_address_$",
												typeString: "type(address)"
											},
											typeName: "address"
										},
										id: 1298,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "10130:24:1",
										typeDescriptions: {
											typeIdentifier: "t_address_payable",
											typeString: "address payable"
										}
									},
									src: "10119:35:1",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								id: 1300,
								nodeType: "ExpressionStatement",
								src: "10119:35:1"
							}
						]
					},
					documentation: "Primarily to assist querying all ids belonging to an owner",
					id: 1302,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowOwner",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1270,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1269,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1302,
								src: "9903:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1268,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9903:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "9902:20:1"
					},
					returnParameters: {
						id: 1275,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1272,
								name: "rowOwner",
								nodeType: "VariableDeclaration",
								scope: 1302,
								src: "9941:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1271,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "9941:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1274,
								name: "createdDate",
								nodeType: "VariableDeclaration",
								scope: 1302,
								src: "9959:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes4",
									typeString: "bytes4"
								},
								typeName: {
									id: 1273,
									name: "bytes4",
									nodeType: "ElementaryTypeName",
									src: "9959:6:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes4",
										typeString: "bytes4"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "9940:38:1"
					},
					scope: 2048,
					src: "9882:280:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1398,
						nodeType: "Block",
						src: "10263:1232:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1320,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1316,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1304,
														src: "10310:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1317,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1310,
														src: "10320:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1314,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 802,
														src: "10282:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1315,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsValueForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 5977,
													src: "10282:27:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
													}
												},
												id: 1318,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "10282:41:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "74727565",
												id: 1319,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "10327:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "10282:49:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "696420646f65736e27742065786973742c2075736520494e53455254",
											id: 1321,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10333:30:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_e062c631cebfcba05fea250b6c3bf895a8069dc2ee280d9759ffc17ff124edf6",
												typeString: "literal_string \"id doesn't exist, use INSERT\""
											},
											value: "id doesn't exist, use INSERT"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_e062c631cebfcba05fea250b6c3bf895a8069dc2ee280d9759ffc17ff124edf6",
												typeString: "literal_string \"id doesn't exist, use INSERT\""
											}
										],
										id: 1313,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "10274:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1322,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10274:90:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1323,
								nodeType: "ExpressionStatement",
								src: "10274:90:1"
							},
							{
								assignments: [
									1325,
									1327
								],
								declarations: [
									{
										constant: false,
										id: 1325,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1398,
										src: "10376:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1324,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "10376:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									},
									{
										constant: false,
										id: 1327,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1398,
										src: "10396:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1326,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "10396:7:1",
											stateMutability: "nonpayable",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1331,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1329,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1304,
											src: "10433:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1328,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1805,
										src: "10416:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1330,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10416:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10375:67:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											id: 1335,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1333,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1325,
												src: "10525:10:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											},
											nodeType: "BinaryOperation",
											operator: ">",
											rightExpression: {
												argumentTypes: null,
												hexValue: "30",
												id: 1334,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "10538:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "10525:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f74205550444154452073797374656d207461626c65",
											id: 1336,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10541:28:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_1fb6cfc287a881526d28c733853bf507a7d955871af98ab667d0dc8dcd08d8eb",
												typeString: "literal_string \"Cannot UPDATE system table\""
											},
											value: "Cannot UPDATE system table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_1fb6cfc287a881526d28c733853bf507a7d955871af98ab667d0dc8dcd08d8eb",
												typeString: "literal_string \"Cannot UPDATE system table\""
											}
										],
										id: 1332,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "10517:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1337,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10517:53:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1338,
								nodeType: "ExpressionStatement",
								src: "10517:53:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1352,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												id: 1347,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													},
													id: 1342,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1340,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1325,
														src: "10649:10:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													},
													nodeType: "BinaryOperation",
													operator: ">",
													rightExpression: {
														argumentTypes: null,
														hexValue: "31",
														id: 1341,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "10662:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "10649:14:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												nodeType: "BinaryOperation",
												operator: "||",
												rightExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													},
													id: 1346,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														"arguments": [
														],
														expression: {
															argumentTypes: [
															],
															id: 1343,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4556,
															src: "10667:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1344,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "10667:9:1",
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														}
													},
													nodeType: "BinaryOperation",
													operator: "==",
													rightExpression: {
														argumentTypes: null,
														hexValue: "74727565",
														id: 1345,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "10680:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "10667:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "10649:35:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "||",
											rightExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_address",
													typeString: "address"
												},
												id: 1351,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1348,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1327,
													src: "10688:8:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												nodeType: "BinaryOperation",
												operator: "==",
												rightExpression: {
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1349,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3144
														],
														referencedDeclaration: 3144,
														src: "10700:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1350,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "10700:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "10688:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "10649:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e2055504441544520696e746f2074686973207461626c65",
											id: 1353,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10714:48:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_41d537d2cf51ebb4c64ddf99f5e6ba67c43bcb89a0eb79039efa385d59e725e8",
												typeString: "literal_string \"Only owner/delegate can UPDATE into this table\""
											},
											value: "Only owner/delegate can UPDATE into this table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_41d537d2cf51ebb4c64ddf99f5e6ba67c43bcb89a0eb79039efa385d59e725e8",
												typeString: "literal_string \"Only owner/delegate can UPDATE into this table\""
											}
										],
										id: 1339,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "10641:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1354,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10641:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1355,
								nodeType: "ExpressionStatement",
								src: "10641:122:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1358,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1356,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1325,
										src: "10937:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "BinaryOperation",
									operator: ">=",
									rightExpression: {
										argumentTypes: null,
										hexValue: "32",
										id: 1357,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "10951:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_2_by_1",
											typeString: "int_const 2"
										},
										value: "2"
									},
									src: "10937:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1397,
								nodeType: "IfStatement",
								src: "10933:556:1",
								trueBody: {
									id: 1396,
									nodeType: "Block",
									src: "10954:535:1",
									statements: [
										{
											assignments: [
												1360
											],
											declarations: [
												{
													constant: false,
													id: 1360,
													name: "rowMetaData",
													nodeType: "VariableDeclaration",
													scope: 1396,
													src: "11050:19:1",
													stateVariable: false,
													storageLocation: "default",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													},
													typeName: {
														id: 1359,
														name: "bytes32",
														nodeType: "ElementaryTypeName",
														src: "11050:7:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													value: null,
													visibility: "internal"
												}
											],
											id: 1365,
											initialValue: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1363,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1308,
														src: "11098:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1361,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "11072:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1362,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytes32ForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7511,
													src: "11072:25:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
													}
												},
												id: 1364,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "11072:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											nodeType: "VariableDeclarationStatement",
											src: "11050:59:1"
										},
										{
											assignments: [
												1367
											],
											declarations: [
												{
													constant: false,
													id: 1367,
													name: "rowOwner",
													nodeType: "VariableDeclaration",
													scope: 1396,
													src: "11123:16:1",
													stateVariable: false,
													storageLocation: "default",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													},
													typeName: {
														id: 1366,
														name: "address",
														nodeType: "ElementaryTypeName",
														src: "11123:7:1",
														stateMutability: "nonpayable",
														typeDescriptions: {
															typeIdentifier: "t_address",
															typeString: "address"
														}
													},
													value: null,
													visibility: "internal"
												}
											],
											id: 1375,
											initialValue: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														commonType: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														},
														id: 1373,
														isConstant: false,
														isLValue: false,
														isPure: false,
														lValueRequested: false,
														leftExpression: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	id: 1370,
																	name: "rowMetaData",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 1360,
																	src: "11158:11:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																}
															],
															expression: {
																argumentTypes: [
																	{
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																],
																id: 1369,
																isConstant: false,
																isLValue: false,
																isPure: true,
																lValueRequested: false,
																nodeType: "ElementaryTypeNameExpression",
																src: "11150:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_type$_t_uint256_$",
																	typeString: "type(uint256)"
																},
																typeName: "uint256"
															},
															id: 1371,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "typeConversion",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "11150:20:1",
															typeDescriptions: {
																typeIdentifier: "t_uint256",
																typeString: "uint256"
															}
														},
														nodeType: "BinaryOperation",
														operator: ">>",
														rightExpression: {
															argumentTypes: null,
															hexValue: "3332",
															id: 1372,
															isConstant: false,
															isLValue: false,
															isPure: true,
															kind: "number",
															lValueRequested: false,
															nodeType: "Literal",
															src: "11172:2:1",
															subdenomination: null,
															typeDescriptions: {
																typeIdentifier: "t_rational_32_by_1",
																typeString: "int_const 32"
															},
															value: "32"
														},
														src: "11150:24:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													],
													id: 1368,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "11142:7:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_address_$",
														typeString: "type(address)"
													},
													typeName: "address"
												},
												id: 1374,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "11142:33:1",
												typeDescriptions: {
													typeIdentifier: "t_address_payable",
													typeString: "address payable"
												}
											},
											nodeType: "VariableDeclarationStatement",
											src: "11123:52:1"
										},
										{
											condition: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_address",
													typeString: "address"
												},
												id: 1379,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1376,
													name: "rowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1367,
													src: "11261:8:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												nodeType: "BinaryOperation",
												operator: "==",
												rightExpression: {
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1377,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3144
														],
														referencedDeclaration: 3144,
														src: "11273:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1378,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "11273:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "11261:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											falseBody: {
												id: 1394,
												nodeType: "Block",
												src: "11331:148:1",
												statements: [
													{
														expression: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	commonType: {
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	},
																	id: 1390,
																	isConstant: false,
																	isLValue: false,
																	isPure: false,
																	lValueRequested: false,
																	leftExpression: {
																		argumentTypes: null,
																		commonType: {
																			typeIdentifier: "t_bool",
																			typeString: "bool"
																		},
																		id: 1385,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		lValueRequested: false,
																		leftExpression: {
																			argumentTypes: null,
																			"arguments": [
																			],
																			expression: {
																				argumentTypes: [
																				],
																				id: 1382,
																				name: "isOwner",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																				],
																				referencedDeclaration: 4556,
																				src: "11357:7:1",
																				typeDescriptions: {
																					typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																					typeString: "function () view returns (bool)"
																				}
																			},
																			id: 1383,
																			isConstant: false,
																			isLValue: false,
																			isPure: false,
																			kind: "functionCall",
																			lValueRequested: false,
																			names: [
																			],
																			nodeType: "FunctionCall",
																			src: "11357:9:1",
																			typeDescriptions: {
																				typeIdentifier: "t_bool",
																				typeString: "bool"
																			}
																		},
																		nodeType: "BinaryOperation",
																		operator: "==",
																		rightExpression: {
																			argumentTypes: null,
																			hexValue: "74727565",
																			id: 1384,
																			isConstant: false,
																			isLValue: false,
																			isPure: true,
																			kind: "bool",
																			lValueRequested: false,
																			nodeType: "Literal",
																			src: "11370:4:1",
																			subdenomination: null,
																			typeDescriptions: {
																				typeIdentifier: "t_bool",
																				typeString: "bool"
																			},
																			value: "true"
																		},
																		src: "11357:17:1",
																		typeDescriptions: {
																			typeIdentifier: "t_bool",
																			typeString: "bool"
																		}
																	},
																	nodeType: "BinaryOperation",
																	operator: "||",
																	rightExpression: {
																		argumentTypes: null,
																		commonType: {
																			typeIdentifier: "t_address",
																			typeString: "address"
																		},
																		id: 1389,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		lValueRequested: false,
																		leftExpression: {
																			argumentTypes: null,
																			id: 1386,
																			name: "delegate",
																			nodeType: "Identifier",
																			overloadedDeclarations: [
																			],
																			referencedDeclaration: 1327,
																			src: "11378:8:1",
																			typeDescriptions: {
																				typeIdentifier: "t_address",
																				typeString: "address"
																			}
																		},
																		nodeType: "BinaryOperation",
																		operator: "==",
																		rightExpression: {
																			argumentTypes: null,
																			"arguments": [
																			],
																			expression: {
																				argumentTypes: [
																				],
																				id: 1387,
																				name: "_msgSender",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																					3144
																				],
																				referencedDeclaration: 3144,
																				src: "11390:10:1",
																				typeDescriptions: {
																					typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																					typeString: "function () view returns (address)"
																				}
																			},
																			id: 1388,
																			isConstant: false,
																			isLValue: false,
																			isPure: false,
																			kind: "functionCall",
																			lValueRequested: false,
																			names: [
																			],
																			nodeType: "FunctionCall",
																			src: "11390:12:1",
																			typeDescriptions: {
																				typeIdentifier: "t_address",
																				typeString: "address"
																			}
																		},
																		src: "11378:24:1",
																		typeDescriptions: {
																			typeIdentifier: "t_bool",
																			typeString: "bool"
																		}
																	},
																	src: "11357:45:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	}
																},
																{
																	argumentTypes: null,
																	hexValue: "4e6f7420726f774f776e6572206f72206f776e65722f64656c656761746520666f722055504441544520696e746f2074686973207461626c65",
																	id: 1391,
																	isConstant: false,
																	isLValue: false,
																	isPure: true,
																	kind: "string",
																	lValueRequested: false,
																	nodeType: "Literal",
																	src: "11404:59:1",
																	subdenomination: null,
																	typeDescriptions: {
																		typeIdentifier: "t_stringliteral_627ce0c74b5075c1ccd59f2bdb6411a148fdf65d04b3c288101b934a5fb8eae0",
																		typeString: "literal_string \"Not rowOwner or owner/delegate for UPDATE into this table\""
																	},
																	value: "Not rowOwner or owner/delegate for UPDATE into this table"
																}
															],
															expression: {
																argumentTypes: [
																	{
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	},
																	{
																		typeIdentifier: "t_stringliteral_627ce0c74b5075c1ccd59f2bdb6411a148fdf65d04b3c288101b934a5fb8eae0",
																		typeString: "literal_string \"Not rowOwner or owner/delegate for UPDATE into this table\""
																	}
																],
																id: 1381,
																name: "require",
																nodeType: "Identifier",
																overloadedDeclarations: [
																	10551,
																	10552
																],
																referencedDeclaration: 10552,
																src: "11349:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
																	typeString: "function (bool,string memory) pure"
																}
															},
															id: 1392,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "11349:115:1",
															typeDescriptions: {
																typeIdentifier: "t_tuple$__$",
																typeString: "tuple()"
															}
														},
														id: 1393,
														nodeType: "ExpressionStatement",
														src: "11349:115:1"
													}
												]
											},
											id: 1395,
											nodeType: "IfStatement",
											src: "11257:222:1",
											trueBody: {
												id: 1380,
												nodeType: "Block",
												src: "11286:39:1",
												statements: [
												]
											}
										}
									]
								}
							}
						]
					},
					documentation: null,
					id: 1399,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "updateCheck",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1311,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1304,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1399,
								src: "10189:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1303,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "10189:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1306,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1399,
								src: "10207:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1305,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "10207:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1308,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1399,
								src: "10222:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1307,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "10222:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1310,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1399,
								src: "10242:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1309,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "10242:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "10188:65:1"
					},
					returnParameters: {
						id: 1312,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "10263:0:1"
					},
					scope: 2048,
					src: "10168:1327:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1454,
						nodeType: "Block",
						src: "11651:456:1",
						statements: [
							{
								assignments: [
									1413
								],
								declarations: [
									{
										constant: false,
										id: 1413,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1454,
										src: "11662:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1412,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "11662:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1418,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1415,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1403,
											src: "11692:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1416,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1401,
											src: "11699:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1414,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "11683:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1417,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11683:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "11662:46:1"
							},
							{
								assignments: [
									1420
								],
								declarations: [
									{
										constant: false,
										id: 1420,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1454,
										src: "11718:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1419,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "11718:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1425,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1422,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1405,
											src: "11753:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1423,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1413,
											src: "11763:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1421,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "11744:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1424,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11744:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "11718:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1427,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1401,
											src: "11797:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1428,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1403,
											src: "11807:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1429,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1413,
											src: "11814:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1430,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1407,
											src: "11826:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1426,
										name: "updateCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1399,
										src: "11785:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1431,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11785:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1432,
								nodeType: "ExpressionStatement",
								src: "11785:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1433,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1930,
										src: "11869:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1434,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11869:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1435,
								nodeType: "ExpressionStatement",
								src: "11869:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1439,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1420,
											src: "11956:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1441,
													name: "val",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1409,
													src: "11981:3:1",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												],
												id: 1440,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "11973:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1442,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "11973:12:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1436,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "11932:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1438,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7996,
										src: "11932:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1443,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11932:54:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1444,
								nodeType: "ExpressionStatement",
								src: "11932:54:1"
							},
							{
								eventCall: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1446,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1401,
											src: "12058:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1447,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1405,
											src: "12068:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1448,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1409,
											src: "12078:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1449,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1407,
											src: "12083:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											"arguments": [
											],
											expression: {
												argumentTypes: [
												],
												id: 1450,
												name: "_msgSender",
												nodeType: "Identifier",
												overloadedDeclarations: [
													3144
												],
												referencedDeclaration: 3144,
												src: "12087:10:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 1451,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "12087:12:1",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_address",
												typeString: "address"
											}
										],
										id: 1445,
										name: "InsertVal",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1066,
										src: "12048:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_event_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_address_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32,address)"
										}
									},
									id: 1452,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12048:52:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1453,
								nodeType: "EmitStatement",
								src: "12043:57:1"
							}
						]
					},
					documentation: null,
					id: 1455,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "updateVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1410,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1401,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1455,
								src: "11530:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1400,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11530:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1403,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1455,
								src: "11556:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1402,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11556:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1405,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1455,
								src: "11579:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1404,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11579:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1407,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1455,
								src: "11606:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1406,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11606:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1409,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1455,
								src: "11626:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1408,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11626:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "11519:119:1"
					},
					returnParameters: {
						id: 1411,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "11651:0:1"
					},
					scope: 2048,
					src: "11501:606:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1549,
						nodeType: "Block",
						src: "12208:1126:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1473,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1469,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1457,
														src: "12255:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1470,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1463,
														src: "12265:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														},
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1467,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 802,
														src: "12227:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1468,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsValueForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 5977,
													src: "12227:27:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
													}
												},
												id: 1471,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "12227:41:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "74727565",
												id: 1472,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "12272:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "12227:49:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "696420646f65736e2774206578697374",
											id: 1474,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "12278:18:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_db03d7ca062012de69c7826250fe821647bd15958d13d3f34e50a74943c7e2a1",
												typeString: "literal_string \"id doesn't exist\""
											},
											value: "id doesn't exist"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_db03d7ca062012de69c7826250fe821647bd15958d13d3f34e50a74943c7e2a1",
												typeString: "literal_string \"id doesn't exist\""
											}
										],
										id: 1466,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "12219:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1475,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12219:78:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1476,
								nodeType: "ExpressionStatement",
								src: "12219:78:1"
							},
							{
								assignments: [
									1478,
									1480
								],
								declarations: [
									{
										constant: false,
										id: 1478,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1549,
										src: "12309:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1477,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "12309:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									},
									{
										constant: false,
										id: 1480,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1549,
										src: "12329:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1479,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "12329:7:1",
											stateMutability: "nonpayable",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1484,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1482,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1457,
											src: "12366:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1481,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1805,
										src: "12349:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1483,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12349:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "12308:67:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											id: 1488,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1486,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1478,
												src: "12458:10:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											},
											nodeType: "BinaryOperation",
											operator: ">",
											rightExpression: {
												argumentTypes: null,
												hexValue: "30",
												id: 1487,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "12471:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "12458:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65",
											id: 1489,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "12474:33:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_132c13b1ffd52b2761f3e4441db33850ce1f140ca1599ac0789f819d4b4791cd",
												typeString: "literal_string \"Cannot DELETE from system table\""
											},
											value: "Cannot DELETE from system table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_132c13b1ffd52b2761f3e4441db33850ce1f140ca1599ac0789f819d4b4791cd",
												typeString: "literal_string \"Cannot DELETE from system table\""
											}
										],
										id: 1485,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "12450:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1490,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12450:58:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1491,
								nodeType: "ExpressionStatement",
								src: "12450:58:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1505,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												id: 1500,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													},
													id: 1495,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1493,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1478,
														src: "12587:10:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													},
													nodeType: "BinaryOperation",
													operator: ">",
													rightExpression: {
														argumentTypes: null,
														hexValue: "31",
														id: 1494,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "12600:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "12587:14:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												nodeType: "BinaryOperation",
												operator: "||",
												rightExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													},
													id: 1499,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														"arguments": [
														],
														expression: {
															argumentTypes: [
															],
															id: 1496,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4556,
															src: "12605:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1497,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "12605:9:1",
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														}
													},
													nodeType: "BinaryOperation",
													operator: "==",
													rightExpression: {
														argumentTypes: null,
														hexValue: "74727565",
														id: 1498,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "12618:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "12605:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "12587:35:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "||",
											rightExpression: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_address",
													typeString: "address"
												},
												id: 1504,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1501,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1480,
													src: "12626:8:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												nodeType: "BinaryOperation",
												operator: "==",
												rightExpression: {
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1502,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3144
														],
														referencedDeclaration: 3144,
														src: "12638:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1503,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "12638:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "12626:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "12587:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e2044454c4554452066726f6d2074686973207461626c65",
											id: 1506,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "12652:48:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_c33372ce630f0cab4512ab6a1cf4a2edfc443bf5b1df150e7f701bd1549103a6",
												typeString: "literal_string \"Only owner/delegate can DELETE from this table\""
											},
											value: "Only owner/delegate can DELETE from this table"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_c33372ce630f0cab4512ab6a1cf4a2edfc443bf5b1df150e7f701bd1549103a6",
												typeString: "literal_string \"Only owner/delegate can DELETE from this table\""
											}
										],
										id: 1492,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "12579:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1507,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12579:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1508,
								nodeType: "ExpressionStatement",
								src: "12579:122:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1511,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1509,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1478,
										src: "12875:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "BinaryOperation",
									operator: ">=",
									rightExpression: {
										argumentTypes: null,
										hexValue: "32",
										id: 1510,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "12889:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_2_by_1",
											typeString: "int_const 2"
										},
										value: "2"
									},
									src: "12875:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1548,
								nodeType: "IfStatement",
								src: "12871:457:1",
								trueBody: {
									id: 1547,
									nodeType: "Block",
									src: "12892:436:1",
									statements: [
										{
											condition: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												id: 1518,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													"arguments": [
													],
													expression: {
														argumentTypes: [
														],
														id: 1512,
														name: "isOwner",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 4556,
														src: "12910:7:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
															typeString: "function () view returns (bool)"
														}
													},
													id: 1513,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "12910:9:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												nodeType: "BinaryOperation",
												operator: "||",
												rightExpression: {
													argumentTypes: null,
													commonType: {
														typeIdentifier: "t_address",
														typeString: "address"
													},
													id: 1517,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1514,
														name: "delegate",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1480,
														src: "12923:8:1",
														typeDescriptions: {
															typeIdentifier: "t_address",
															typeString: "address"
														}
													},
													nodeType: "BinaryOperation",
													operator: "==",
													rightExpression: {
														argumentTypes: null,
														"arguments": [
														],
														expression: {
															argumentTypes: [
															],
															id: 1515,
															name: "_msgSender",
															nodeType: "Identifier",
															overloadedDeclarations: [
																3144
															],
															referencedDeclaration: 3144,
															src: "12935:10:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																typeString: "function () view returns (address)"
															}
														},
														id: 1516,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "12935:12:1",
														typeDescriptions: {
															typeIdentifier: "t_address",
															typeString: "address"
														}
													},
													src: "12923:24:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "12910:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											falseBody: {
												id: 1545,
												nodeType: "Block",
												src: "12993:325:1",
												statements: [
													{
														assignments: [
															1521
														],
														declarations: [
															{
																constant: false,
																id: 1521,
																name: "rowMetaData",
																nodeType: "VariableDeclaration",
																scope: 1545,
																src: "13096:19:1",
																stateVariable: false,
																storageLocation: "default",
																typeDescriptions: {
																	typeIdentifier: "t_bytes32",
																	typeString: "bytes32"
																},
																typeName: {
																	id: 1520,
																	name: "bytes32",
																	nodeType: "ElementaryTypeName",
																	src: "13096:7:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																},
																value: null,
																visibility: "internal"
															}
														],
														id: 1526,
														initialValue: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	id: 1524,
																	name: "idTableKey",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 1459,
																	src: "13144:10:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																}
															],
															expression: {
																argumentTypes: [
																	{
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																],
																expression: {
																	argumentTypes: null,
																	id: 1522,
																	name: "database",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 813,
																	src: "13118:8:1",
																	typeDescriptions: {
																		typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
																		typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
																	}
																},
																id: 1523,
																isConstant: false,
																isLValue: true,
																isPure: false,
																lValueRequested: false,
																memberName: "getBytes32ForKey",
																nodeType: "MemberAccess",
																referencedDeclaration: 7511,
																src: "13118:25:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
																	typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
																}
															},
															id: 1525,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "13118:37:1",
															typeDescriptions: {
																typeIdentifier: "t_bytes32",
																typeString: "bytes32"
															}
														},
														nodeType: "VariableDeclarationStatement",
														src: "13096:59:1"
													},
													{
														assignments: [
															1528
														],
														declarations: [
															{
																constant: false,
																id: 1528,
																name: "rowOwner",
																nodeType: "VariableDeclaration",
																scope: 1545,
																src: "13173:16:1",
																stateVariable: false,
																storageLocation: "default",
																typeDescriptions: {
																	typeIdentifier: "t_address",
																	typeString: "address"
																},
																typeName: {
																	id: 1527,
																	name: "address",
																	nodeType: "ElementaryTypeName",
																	src: "13173:7:1",
																	stateMutability: "nonpayable",
																	typeDescriptions: {
																		typeIdentifier: "t_address",
																		typeString: "address"
																	}
																},
																value: null,
																visibility: "internal"
															}
														],
														id: 1536,
														initialValue: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	commonType: {
																		typeIdentifier: "t_uint256",
																		typeString: "uint256"
																	},
																	id: 1534,
																	isConstant: false,
																	isLValue: false,
																	isPure: false,
																	lValueRequested: false,
																	leftExpression: {
																		argumentTypes: null,
																		"arguments": [
																			{
																				argumentTypes: null,
																				id: 1531,
																				name: "rowMetaData",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																				],
																				referencedDeclaration: 1521,
																				src: "13208:11:1",
																				typeDescriptions: {
																					typeIdentifier: "t_bytes32",
																					typeString: "bytes32"
																				}
																			}
																		],
																		expression: {
																			argumentTypes: [
																				{
																					typeIdentifier: "t_bytes32",
																					typeString: "bytes32"
																				}
																			],
																			id: 1530,
																			isConstant: false,
																			isLValue: false,
																			isPure: true,
																			lValueRequested: false,
																			nodeType: "ElementaryTypeNameExpression",
																			src: "13200:7:1",
																			typeDescriptions: {
																				typeIdentifier: "t_type$_t_uint256_$",
																				typeString: "type(uint256)"
																			},
																			typeName: "uint256"
																		},
																		id: 1532,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		kind: "typeConversion",
																		lValueRequested: false,
																		names: [
																		],
																		nodeType: "FunctionCall",
																		src: "13200:20:1",
																		typeDescriptions: {
																			typeIdentifier: "t_uint256",
																			typeString: "uint256"
																		}
																	},
																	nodeType: "BinaryOperation",
																	operator: ">>",
																	rightExpression: {
																		argumentTypes: null,
																		hexValue: "3332",
																		id: 1533,
																		isConstant: false,
																		isLValue: false,
																		isPure: true,
																		kind: "number",
																		lValueRequested: false,
																		nodeType: "Literal",
																		src: "13222:2:1",
																		subdenomination: null,
																		typeDescriptions: {
																			typeIdentifier: "t_rational_32_by_1",
																			typeString: "int_const 32"
																		},
																		value: "32"
																	},
																	src: "13200:24:1",
																	typeDescriptions: {
																		typeIdentifier: "t_uint256",
																		typeString: "uint256"
																	}
																}
															],
															expression: {
																argumentTypes: [
																	{
																		typeIdentifier: "t_uint256",
																		typeString: "uint256"
																	}
																],
																id: 1529,
																isConstant: false,
																isLValue: false,
																isPure: true,
																lValueRequested: false,
																nodeType: "ElementaryTypeNameExpression",
																src: "13192:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_type$_t_address_$",
																	typeString: "type(address)"
																},
																typeName: "address"
															},
															id: 1535,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "typeConversion",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "13192:33:1",
															typeDescriptions: {
																typeIdentifier: "t_address_payable",
																typeString: "address payable"
															}
														},
														nodeType: "VariableDeclarationStatement",
														src: "13173:52:1"
													},
													{
														expression: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	commonType: {
																		typeIdentifier: "t_address",
																		typeString: "address"
																	},
																	id: 1541,
																	isConstant: false,
																	isLValue: false,
																	isPure: false,
																	lValueRequested: false,
																	leftExpression: {
																		argumentTypes: null,
																		id: 1538,
																		name: "rowOwner",
																		nodeType: "Identifier",
																		overloadedDeclarations: [
																		],
																		referencedDeclaration: 1528,
																		src: "13251:8:1",
																		typeDescriptions: {
																			typeIdentifier: "t_address",
																			typeString: "address"
																		}
																	},
																	nodeType: "BinaryOperation",
																	operator: "==",
																	rightExpression: {
																		argumentTypes: null,
																		"arguments": [
																		],
																		expression: {
																			argumentTypes: [
																			],
																			id: 1539,
																			name: "_msgSender",
																			nodeType: "Identifier",
																			overloadedDeclarations: [
																				3144
																			],
																			referencedDeclaration: 3144,
																			src: "13263:10:1",
																			typeDescriptions: {
																				typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																				typeString: "function () view returns (address)"
																			}
																		},
																		id: 1540,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		kind: "functionCall",
																		lValueRequested: false,
																		names: [
																		],
																		nodeType: "FunctionCall",
																		src: "13263:12:1",
																		typeDescriptions: {
																			typeIdentifier: "t_address",
																			typeString: "address"
																		}
																	},
																	src: "13251:24:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	}
																},
																{
																	argumentTypes: null,
																	hexValue: "53656e646572206e6f74206f776e6572206f6620726f77",
																	id: 1542,
																	isConstant: false,
																	isLValue: false,
																	isPure: true,
																	kind: "string",
																	lValueRequested: false,
																	nodeType: "Literal",
																	src: "13277:25:1",
																	subdenomination: null,
																	typeDescriptions: {
																		typeIdentifier: "t_stringliteral_fa8a74fd1acb40aac2f8444f4811d8b38e0f8d0e7daab82b9b6c362343d2fb4a",
																		typeString: "literal_string \"Sender not owner of row\""
																	},
																	value: "Sender not owner of row"
																}
															],
															expression: {
																argumentTypes: [
																	{
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	},
																	{
																		typeIdentifier: "t_stringliteral_fa8a74fd1acb40aac2f8444f4811d8b38e0f8d0e7daab82b9b6c362343d2fb4a",
																		typeString: "literal_string \"Sender not owner of row\""
																	}
																],
																id: 1537,
																name: "require",
																nodeType: "Identifier",
																overloadedDeclarations: [
																	10551,
																	10552
																],
																referencedDeclaration: 10552,
																src: "13243:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
																	typeString: "function (bool,string memory) pure"
																}
															},
															id: 1543,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "13243:60:1",
															typeDescriptions: {
																typeIdentifier: "t_tuple$__$",
																typeString: "tuple()"
															}
														},
														id: 1544,
														nodeType: "ExpressionStatement",
														src: "13243:60:1"
													}
												]
											},
											id: 1546,
											nodeType: "IfStatement",
											src: "12906:412:1",
											trueBody: {
												id: 1519,
												nodeType: "Block",
												src: "12948:39:1",
												statements: [
												]
											}
										}
									]
								}
							}
						]
					},
					documentation: null,
					id: 1550,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteCheck",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1464,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1457,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1550,
								src: "12134:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1456,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12134:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1459,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1550,
								src: "12152:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1458,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12152:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1461,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1550,
								src: "12172:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1460,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12172:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1463,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1550,
								src: "12187:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1462,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12187:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "12133:65:1"
					},
					returnParameters: {
						id: 1465,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "12208:0:1"
					},
					scope: 2048,
					src: "12113:1221:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1599,
						nodeType: "Block",
						src: "13633:1063:1",
						statements: [
							{
								assignments: [
									1562
								],
								declarations: [
									{
										constant: false,
										id: 1562,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1599,
										src: "13644:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1561,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "13644:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1567,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1564,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1554,
											src: "13674:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1565,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1552,
											src: "13681:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1563,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "13665:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1566,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13665:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "13644:46:1"
							},
							{
								assignments: [
									1569
								],
								declarations: [
									{
										constant: false,
										id: 1569,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1599,
										src: "13700:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1568,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "13700:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1574,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1571,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1556,
											src: "13735:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1572,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1562,
											src: "13745:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1570,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "13726:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1573,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13726:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "13700:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1576,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1552,
											src: "13779:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1577,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1562,
											src: "13789:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1578,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1554,
											src: "13801:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1579,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1558,
											src: "13808:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1575,
										name: "deleteCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1550,
										src: "13767:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1580,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13767:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1581,
								nodeType: "ExpressionStatement",
								src: "13767:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1582,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1930,
										src: "13851:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1583,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13851:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1584,
								nodeType: "ExpressionStatement",
								src: "13851:20:1"
							},
							{
								assignments: [
									1586
								],
								declarations: [
									{
										constant: false,
										id: 1586,
										name: "removed",
										nodeType: "VariableDeclaration",
										scope: 1599,
										src: "13908:12:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										typeName: {
											id: 1585,
											name: "bool",
											nodeType: "ElementaryTypeName",
											src: "13908:4:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1591,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1589,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1569,
											src: "13942:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1587,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "13923:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1588,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8487,
										src: "13923:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 1590,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13923:35:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "13908:50:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1595,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1593,
												name: "removed",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1586,
												src: "13977:7:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "74727565",
												id: 1594,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "13988:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "13977:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "6572726f722072656d6f76696e67206b6579",
											id: 1596,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "13994:20:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_9802ffb053ccae9d16816deee5376dcb8b1c3e7f6a19281a861295bb0e1ac720",
												typeString: "literal_string \"error removing key\""
											},
											value: "error removing key"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_9802ffb053ccae9d16816deee5376dcb8b1c3e7f6a19281a861295bb0e1ac720",
												typeString: "literal_string \"error removing key\""
											}
										],
										id: 1592,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "13969:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1597,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13969:46:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1598,
								nodeType: "ExpressionStatement",
								src: "13969:46:1"
							}
						]
					},
					documentation: "@dev TODO: add modifier checks based on update\n     * TODO: this needs to properly remove the row when there are multiple ids\n     ",
					id: 1600,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1559,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1552,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1600,
								src: "13532:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1551,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13532:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1554,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1600,
								src: "13558:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1553,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13558:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1556,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1600,
								src: "13581:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1555,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13581:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1558,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1600,
								src: "13608:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1557,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13608:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "13521:104:1"
					},
					returnParameters: {
						id: 1560,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "13633:0:1"
					},
					scope: 2048,
					src: "13503:1193:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1633,
						nodeType: "Block",
						src: "15078:254:1",
						statements: [
							{
								assignments: [
									1610
								],
								declarations: [
									{
										constant: false,
										id: 1610,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1633,
										src: "15089:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1609,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "15089:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1615,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1612,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1604,
											src: "15119:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1613,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1602,
											src: "15126:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1611,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1762,
										src: "15110:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1614,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "15110:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "15089:46:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1617,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1602,
											src: "15158:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1618,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1610,
											src: "15168:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1619,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1604,
											src: "15180:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1620,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1606,
											src: "15187:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1616,
										name: "deleteCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1550,
										src: "15146:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1621,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "15146:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1622,
								nodeType: "ExpressionStatement",
								src: "15146:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1623,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1930,
										src: "15230:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1624,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "15230:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1625,
								nodeType: "ExpressionStatement",
								src: "15230:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1629,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1602,
											src: "15312:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1630,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1606,
											src: "15322:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1626,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "15286:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1628,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5948,
										src: "15286:25:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1631,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "15286:39:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1632,
								nodeType: "ExpressionStatement",
								src: "15286:39:1"
							}
						]
					},
					documentation: null,
					id: 1634,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteRow",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1607,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1602,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1634,
								src: "15004:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1601,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15004:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1604,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1634,
								src: "15030:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1603,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15030:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1606,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1634,
								src: "15053:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1605,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15053:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "14993:77:1"
					},
					returnParameters: {
						id: 1608,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "15078:0:1"
					},
					scope: 2048,
					src: "14975:357:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1646,
						nodeType: "Block",
						src: "16721:49:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1643,
											name: "key",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1636,
											src: "16759:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1641,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "16738:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1642,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7338,
										src: "16738:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1644,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16738:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 1640,
								id: 1645,
								nodeType: "Return",
								src: "16731:32:1"
							}
						]
					},
					documentation: "@dev Table actual insert call, NOTE this doesn't work on testnet currently due to a stack size issue,\n     but it can work with a paid transaction I guess",
					id: 1647,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "checkDataKey",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1637,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1636,
								name: "key",
								nodeType: "VariableDeclaration",
								scope: 1647,
								src: "16679:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1635,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "16679:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "16678:13:1"
					},
					returnParameters: {
						id: 1640,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1639,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1647,
								src: "16715:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 1638,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "16715:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "16714:6:1"
					},
					scope: 2048,
					src: "16657:113:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1670,
						nodeType: "Block",
						src: "16980:182:1",
						statements: [
							{
								condition: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1656,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1649,
											src: "17016:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1654,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "16995:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1655,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7338,
										src: "16995:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1657,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16995:37:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: {
									id: 1668,
									nodeType: "Block",
									src: "17114:42:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "30",
														id: 1665,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "17143:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_0_by_1",
															typeString: "int_const 0"
														},
														value: "0"
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_rational_0_by_1",
															typeString: "int_const 0"
														}
													],
													id: 1664,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "17135:7:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_bytes32_$",
														typeString: "type(bytes32)"
													},
													typeName: "bytes32"
												},
												id: 1666,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17135:10:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											functionReturnParameters: 1653,
											id: 1667,
											nodeType: "Return",
											src: "17128:17:1"
										}
									]
								},
								id: 1669,
								nodeType: "IfStatement",
								src: "16991:165:1",
								trueBody: {
									id: 1663,
									nodeType: "Block",
									src: "17034:74:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1660,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1649,
														src: "17081:15:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1658,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "17055:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1659,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytes32ForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7511,
													src: "17055:25:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
													}
												},
												id: 1661,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17055:42:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											functionReturnParameters: 1653,
											id: 1662,
											nodeType: "Return",
											src: "17048:49:1"
										}
									]
								}
							}
						]
					},
					documentation: "@dev all data is public, so no need for security checks, we leave the data type handling to the client",
					id: 1671,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowValue",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1650,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1649,
								name: "fieldIdTableKey",
								nodeType: "VariableDeclaration",
								scope: 1671,
								src: "16923:23:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1648,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "16923:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "16922:25:1"
					},
					returnParameters: {
						id: 1653,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1652,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1671,
								src: "16971:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1651,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "16971:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "16970:9:1"
					},
					scope: 2048,
					src: "16902:260:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1695,
						nodeType: "Block",
						src: "17254:182:1",
						statements: [
							{
								condition: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1680,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1673,
											src: "17290:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1678,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 813,
											src: "17269:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1679,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7338,
										src: "17269:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1681,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17269:37:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: {
									id: 1693,
									nodeType: "Block",
									src: "17386:44:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "30",
														id: 1690,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "17417:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_0_by_1",
															typeString: "int_const 0"
														},
														value: "0"
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_rational_0_by_1",
															typeString: "int_const 0"
														}
													],
													id: 1689,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "NewExpression",
													src: "17407:9:1",
													typeDescriptions: {
														typeIdentifier: "t_function_objectcreation_pure$_t_uint256_$returns$_t_bytes_memory_$",
														typeString: "function (uint256) pure returns (bytes memory)"
													},
													typeName: {
														id: 1688,
														name: "bytes",
														nodeType: "ElementaryTypeName",
														src: "17411:5:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes_storage_ptr",
															typeString: "bytes"
														}
													}
												},
												id: 1691,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17407:12:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes_memory",
													typeString: "bytes memory"
												}
											},
											functionReturnParameters: 1677,
											id: 1692,
											nodeType: "Return",
											src: "17400:19:1"
										}
									]
								},
								id: 1694,
								nodeType: "IfStatement",
								src: "17265:165:1",
								trueBody: {
									id: 1687,
									nodeType: "Block",
									src: "17308:72:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1684,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1673,
														src: "17353:15:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1682,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 813,
														src: "17329:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7030_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1683,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytesForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7603,
													src: "17329:23:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$_t_bytes32_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7030_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes memory)"
													}
												},
												id: 1685,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17329:40:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes_memory_ptr",
													typeString: "bytes memory"
												}
											},
											functionReturnParameters: 1677,
											id: 1686,
											nodeType: "Return",
											src: "17322:47:1"
										}
									]
								}
							}
						]
					},
					documentation: null,
					id: 1696,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowValueVar",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1674,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1673,
								name: "fieldIdTableKey",
								nodeType: "VariableDeclaration",
								scope: 1696,
								src: "17192:23:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1672,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17192:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17191:25:1"
					},
					returnParameters: {
						id: 1677,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1676,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1696,
								src: "17240:12:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1675,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "17240:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17239:14:1"
					},
					scope: 2048,
					src: "17168:268:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1719,
						nodeType: "Block",
						src: "17724:136:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											id: 1710,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1707,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1698,
														src: "17763:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													],
													expression: {
														argumentTypes: null,
														id: 1705,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 802,
														src: "17743:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1706,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 5822,
													src: "17743:19:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) view returns (bool)"
													}
												},
												id: 1708,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17743:29:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											nodeType: "BinaryOperation",
											operator: "==",
											rightExpression: {
												argumentTypes: null,
												hexValue: "74727565",
												id: 1709,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "17776:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "17743:37:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "7461626c65206e6f742063726561746564",
											id: 1711,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "17782:19:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_db6f56d35b8b4ab5d0197ec2e5e2f49c98a4f29978dd7ddea23231a13bd6f2fb",
												typeString: "literal_string \"table not created\""
											},
											value: "table not created"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_db6f56d35b8b4ab5d0197ec2e5e2f49c98a4f29978dd7ddea23231a13bd6f2fb",
												typeString: "literal_string \"table not created\""
											}
										],
										id: 1704,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "17735:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1712,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17735:67:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1713,
								nodeType: "ExpressionStatement",
								src: "17735:67:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1716,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1698,
											src: "17844:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1714,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "17820:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1715,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "enumerateForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6031,
										src: "17820:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$returns$_t_array$_t_bytes32_$dyn_memory_ptr_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) view returns (bytes32[] memory)"
										}
									},
									id: 1717,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17820:33:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
										typeString: "bytes32[] memory"
									}
								},
								functionReturnParameters: 1703,
								id: 1718,
								nodeType: "Return",
								src: "17813:40:1"
							}
						]
					},
					documentation: "@dev Warning this produces an Error: overflow (operation=\"setValue\", fault=\"overflow\", details=\"Number can only safely store up to 53 bits\")\n     if the table doesn't exist",
					id: 1720,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTableIds",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1699,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1698,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1720,
								src: "17666:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1697,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17666:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17665:18:1"
					},
					returnParameters: {
						id: 1703,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1702,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1720,
								src: "17707:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 1700,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "17707:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 1701,
									length: null,
									nodeType: "ArrayTypeName",
									src: "17707:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17706:18:1"
					},
					scope: 2048,
					src: "17645:215:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1735,
						nodeType: "Block",
						src: "17946:65:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1731,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1722,
											src: "17991:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1732,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1724,
											src: "18001:2:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1729,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 802,
											src: "17963:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5790_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1730,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5977,
										src: "17963:27:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5790_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
										}
									},
									id: 1733,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17963:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 1728,
								id: 1734,
								nodeType: "Return",
								src: "17956:48:1"
							}
						]
					},
					documentation: null,
					id: 1736,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getIdExists",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1725,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1722,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1736,
								src: "17887:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1721,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17887:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1724,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1736,
								src: "17905:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1723,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17905:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17886:30:1"
					},
					returnParameters: {
						id: 1728,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1727,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1736,
								src: "17940:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 1726,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "17940:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17939:6:1"
					},
					scope: 2048,
					src: "17866:145:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1761,
						nodeType: "Block",
						src: "18306:237:1",
						statements: [
							{
								assignments: [
									1746
								],
								declarations: [
									{
										constant: false,
										id: 1746,
										name: "concat",
										nodeType: "VariableDeclaration",
										scope: 1761,
										src: "18316:19:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 1745,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "18316:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1751,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											hexValue: "3634",
											id: 1749,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "18348:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_64_by_1",
												typeString: "int_const 64"
											},
											value: "64"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_rational_64_by_1",
												typeString: "int_const 64"
											}
										],
										id: 1748,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "NewExpression",
										src: "18338:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_objectcreation_pure$_t_uint256_$returns$_t_bytes_memory_$",
											typeString: "function (uint256) pure returns (bytes memory)"
										},
										typeName: {
											id: 1747,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "18342:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										}
									},
									id: 1750,
									isConstant: false,
									isLValue: false,
									isPure: true,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18338:13:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "18316:35:1"
							},
							{
								externalReferences: [
									{
										subKey: {
											declaration: 1738,
											isOffset: false,
											isSlot: false,
											src: "18409:6:1",
											valueSize: 1
										}
									},
									{
										concat: {
											declaration: 1746,
											isOffset: false,
											isSlot: false,
											src: "18396:6:1",
											valueSize: 1
										}
									},
									{
										base: {
											declaration: 1740,
											isOffset: false,
											isSlot: false,
											src: "18453:4:1",
											valueSize: 1
										}
									},
									{
										concat: {
											declaration: 1746,
											isOffset: false,
											isSlot: false,
											src: "18440:6:1",
											valueSize: 1
										}
									}
								],
								id: 1752,
								nodeType: "InlineAssembly",
								operations: "{\n    mstore(add(concat, 64), subKey)\n    mstore(add(concat, 32), base)\n}",
								src: "18362:123:1"
							},
							{
								assignments: [
									1754
								],
								declarations: [
									{
										constant: false,
										id: 1754,
										name: "result",
										nodeType: "VariableDeclaration",
										scope: 1761,
										src: "18478:14:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1753,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "18478:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1758,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1756,
											name: "concat",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1746,
											src: "18505:6:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										],
										id: 1755,
										name: "keccak256",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 10542,
										src: "18495:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_keccak256_pure$_t_bytes_memory_ptr_$returns$_t_bytes32_$",
											typeString: "function (bytes memory) pure returns (bytes32)"
										}
									},
									id: 1757,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18495:17:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "18478:34:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1759,
									name: "result",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1754,
									src: "18530:6:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								functionReturnParameters: 1744,
								id: 1760,
								nodeType: "Return",
								src: "18523:13:1"
							}
						]
					},
					documentation: null,
					id: 1762,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "namehash",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1741,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1738,
								name: "subKey",
								nodeType: "VariableDeclaration",
								scope: 1762,
								src: "18244:14:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1737,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18244:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1740,
								name: "base",
								nodeType: "VariableDeclaration",
								scope: 1762,
								src: "18260:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1739,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18260:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18243:30:1"
					},
					returnParameters: {
						id: 1744,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1743,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1762,
								src: "18297:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1742,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18297:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18296:9:1"
					},
					scope: 2048,
					src: "18226:317:1",
					stateMutability: "pure",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1804,
						nodeType: "Block",
						src: "18781:231:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											},
											id: 1776,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												baseExpression: {
													argumentTypes: null,
													id: 1772,
													name: "_table",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 800,
													src: "18799:6:1",
													typeDescriptions: {
														typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
														typeString: "mapping(bytes32 => bytes32)"
													}
												},
												id: 1774,
												indexExpression: {
													argumentTypes: null,
													id: 1773,
													name: "_tableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1764,
													src: "18806:9:1",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													}
												},
												isConstant: false,
												isLValue: true,
												isPure: false,
												lValueRequested: false,
												nodeType: "IndexAccess",
												src: "18799:17:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											nodeType: "BinaryOperation",
											operator: ">",
											rightExpression: {
												argumentTypes: null,
												hexValue: "30",
												id: 1775,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "18819:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "18799:21:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "7461626c6520646f6573206e6f74206578697374",
											id: 1777,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "18822:22:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_stringliteral_f7e9b396f082020836b3f74274104d95ad6dff938f95c751e799f51d9bb78cba",
												typeString: "literal_string \"table does not exist\""
											},
											value: "table does not exist"
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bool",
												typeString: "bool"
											},
											{
												typeIdentifier: "t_stringliteral_f7e9b396f082020836b3f74274104d95ad6dff938f95c751e799f51d9bb78cba",
												typeString: "literal_string \"table does not exist\""
											}
										],
										id: 1771,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10551,
											10552
										],
										referencedDeclaration: 10552,
										src: "18791:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1778,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18791:54:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1779,
								nodeType: "ExpressionStatement",
								src: "18791:54:1"
							},
							{
								assignments: [
									1781
								],
								declarations: [
									{
										constant: false,
										id: 1781,
										name: "tableMetadata",
										nodeType: "VariableDeclaration",
										scope: 1804,
										src: "18856:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1780,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "18856:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1787,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											baseExpression: {
												argumentTypes: null,
												id: 1783,
												name: "_table",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 800,
												src: "18888:6:1",
												typeDescriptions: {
													typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
													typeString: "mapping(bytes32 => bytes32)"
												}
											},
											id: 1785,
											indexExpression: {
												argumentTypes: null,
												id: 1784,
												name: "_tableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1764,
												src: "18895:9:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											isConstant: false,
											isLValue: true,
											isPure: false,
											lValueRequested: false,
											nodeType: "IndexAccess",
											src: "18888:17:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										],
										id: 1782,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "18880:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1786,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18880:26:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "18856:50:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1794,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1788,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1767,
										src: "18917:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1791,
														name: "tableMetadata",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1781,
														src: "18944:13:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													],
													id: 1790,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "18938:5:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint8_$",
														typeString: "type(uint8)"
													},
													typeName: "uint8"
												},
												id: 1792,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "18938:20:1",
												typeDescriptions: {
													typeIdentifier: "t_uint8",
													typeString: "uint8"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint8",
													typeString: "uint8"
												}
											],
											id: 1789,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "18930:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_uint256_$",
												typeString: "type(uint256)"
											},
											typeName: "uint256"
										},
										id: 1793,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "18930:29:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "18917:42:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1795,
								nodeType: "ExpressionStatement",
								src: "18917:42:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1802,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1796,
										name: "delegate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1769,
										src: "18969:8:1",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												},
												id: 1800,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1798,
													name: "tableMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1781,
													src: "18988:13:1",
													typeDescriptions: {
														typeIdentifier: "t_uint256",
														typeString: "uint256"
													}
												},
												nodeType: "BinaryOperation",
												operator: ">>",
												rightExpression: {
													argumentTypes: null,
													hexValue: "38",
													id: 1799,
													isConstant: false,
													isLValue: false,
													isPure: true,
													kind: "number",
													lValueRequested: false,
													nodeType: "Literal",
													src: "19003:1:1",
													subdenomination: null,
													typeDescriptions: {
														typeIdentifier: "t_rational_8_by_1",
														typeString: "int_const 8"
													},
													value: "8"
												},
												src: "18988:16:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											],
											id: 1797,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "18980:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_address_$",
												typeString: "type(address)"
											},
											typeName: "address"
										},
										id: 1801,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "18980:25:1",
										typeDescriptions: {
											typeIdentifier: "t_address_payable",
											typeString: "address payable"
										}
									},
									src: "18969:36:1",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								id: 1803,
								nodeType: "ExpressionStatement",
								src: "18969:36:1"
							}
						]
					},
					documentation: null,
					id: 1805,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTableMetadata",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1765,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1764,
								name: "_tableKey",
								nodeType: "VariableDeclaration",
								scope: 1805,
								src: "18675:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1763,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18675:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18674:19:1"
					},
					returnParameters: {
						id: 1770,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1767,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 1805,
								src: "18739:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1766,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "18739:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1769,
								name: "delegate",
								nodeType: "VariableDeclaration",
								scope: 1805,
								src: "18759:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1768,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "18759:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18738:38:1"
					},
					scope: 2048,
					src: "18649:363:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1839,
						nodeType: "Block",
						src: "19216:176:1",
						statements: [
							{
								assignments: [
									1817
								],
								declarations: [
									{
										constant: false,
										id: 1817,
										name: "tableMetadata",
										nodeType: "VariableDeclaration",
										scope: 1839,
										src: "19226:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1816,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "19226:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1818,
								initialValue: null,
								nodeType: "VariableDeclarationStatement",
								src: "19226:21:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1821,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1819,
										name: "tableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1817,
										src: "19258:13:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										id: 1820,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1809,
										src: "19275:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										}
									},
									src: "19258:27:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1822,
								nodeType: "ExpressionStatement",
								src: "19258:27:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1829,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1823,
										name: "tableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1817,
										src: "19295:13:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										commonType: {
											typeIdentifier: "t_uint160",
											typeString: "uint160"
										},
										id: 1828,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1825,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1811,
													src: "19320:8:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_address",
														typeString: "address"
													}
												],
												id: 1824,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "19312:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint160_$",
													typeString: "type(uint160)"
												},
												typeName: "uint160"
											},
											id: 1826,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "19312:17:1",
											typeDescriptions: {
												typeIdentifier: "t_uint160",
												typeString: "uint160"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "38",
											id: 1827,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "19331:1:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_8_by_1",
												typeString: "int_const 8"
											},
											value: "8"
										},
										src: "19312:20:1",
										typeDescriptions: {
											typeIdentifier: "t_uint160",
											typeString: "uint160"
										}
									},
									src: "19295:37:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1830,
								nodeType: "ExpressionStatement",
								src: "19295:37:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1837,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 1831,
											name: "_table",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 800,
											src: "19343:6:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
												typeString: "mapping(bytes32 => bytes32)"
											}
										},
										id: 1833,
										indexExpression: {
											argumentTypes: null,
											id: 1832,
											name: "_tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1807,
											src: "19350:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: true,
										nodeType: "IndexAccess",
										src: "19343:17:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1835,
												name: "tableMetadata",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1817,
												src: "19371:13:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											],
											id: 1834,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "19363:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_bytes32_$",
												typeString: "type(bytes32)"
											},
											typeName: "bytes32"
										},
										id: 1836,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "19363:22:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									src: "19343:42:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								id: 1838,
								nodeType: "ExpressionStatement",
								src: "19343:42:1"
							}
						]
					},
					documentation: null,
					id: 1840,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1814,
							modifierName: {
								argumentTypes: null,
								id: 1813,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "19206:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "19206:9:1"
						}
					],
					name: "setTableMetadata",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1812,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1807,
								name: "_tableKey",
								nodeType: "VariableDeclaration",
								scope: 1840,
								src: "19143:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1806,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "19143:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1809,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 1840,
								src: "19162:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 1808,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "19162:5:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1811,
								name: "delegate",
								nodeType: "VariableDeclaration",
								scope: 1840,
								src: "19180:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1810,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "19180:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "19142:55:1"
					},
					returnParameters: {
						id: 1815,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "19216:0:1"
					},
					scope: 2048,
					src: "19117:275:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "private"
				},
				{
					body: {
						id: 1843,
						nodeType: "Block",
						src: "19525:2:1",
						statements: [
						]
					},
					documentation: null,
					id: 1844,
					implemented: true,
					kind: "fallback",
					modifiers: [
					],
					name: "",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1841,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "19505:2:1"
					},
					returnParameters: {
						id: 1842,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "19525:0:1"
					},
					scope: 2048,
					src: "19497:30:1",
					stateMutability: "payable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1892,
						nodeType: "Block",
						src: "20176:234:1",
						statements: [
							{
								assignments: [
									1870
								],
								declarations: [
									{
										constant: false,
										id: 1870,
										name: "curDay",
										nodeType: "VariableDeclaration",
										scope: 1892,
										src: "20187:14:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1869,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "20187:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1873,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1871,
										name: "getCurDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1946,
										src: "20204:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_uint256_$",
											typeString: "function () view returns (uint256)"
										}
									},
									id: 1872,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "20204:11:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "20187:28:1"
							},
							{
								assignments: [
									1875
								],
								declarations: [
									{
										constant: false,
										id: 1875,
										name: "curCounter",
										nodeType: "VariableDeclaration",
										scope: 1892,
										src: "20225:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1874,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "20225:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1879,
								initialValue: {
									argumentTypes: null,
									baseExpression: {
										argumentTypes: null,
										id: 1876,
										name: "gsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 788,
										src: "20246:10:1",
										typeDescriptions: {
											typeIdentifier: "t_mapping$_t_uint256_$_t_uint256_$",
											typeString: "mapping(uint256 => uint256)"
										}
									},
									id: 1878,
									indexExpression: {
										argumentTypes: null,
										id: 1877,
										name: "curDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1870,
										src: "20257:6:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									isConstant: false,
									isLValue: true,
									isPure: false,
									lValueRequested: false,
									nodeType: "IndexAccess",
									src: "20246:18:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "20225:39:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1882,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1880,
										name: "curCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1875,
										src: "20279:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "BinaryOperation",
									operator: ">=",
									rightExpression: {
										argumentTypes: null,
										id: 1881,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 790,
										src: "20293:17:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									src: "20279:31:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1888,
								nodeType: "IfStatement",
								src: "20275:90:1",
								trueBody: {
									id: 1887,
									nodeType: "Block",
									src: "20311:54:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "3131",
														id: 1884,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "20351:2:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_11_by_1",
															typeString: "int_const 11"
														},
														value: "11"
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_rational_11_by_1",
															typeString: "int_const 11"
														}
													],
													id: 1883,
													name: "_rejectRelayedCall",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 3704,
													src: "20332:18:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_pure$_t_uint256_$returns$_t_uint256_$_t_bytes_memory_ptr_$",
														typeString: "function (uint256) pure returns (uint256,bytes memory)"
													}
												},
												id: 1885,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "20332:22:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$_t_uint256_$_t_bytes_memory_ptr_$",
													typeString: "tuple(uint256,bytes memory)"
												}
											},
											functionReturnParameters: 1868,
											id: 1886,
											nodeType: "Return",
											src: "20325:29:1"
										}
									]
								}
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1889,
										name: "_approveRelayedCall",
										nodeType: "Identifier",
										overloadedDeclarations: [
											3674,
											3688
										],
										referencedDeclaration: 3674,
										src: "20382:19:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$__$returns$_t_uint256_$_t_bytes_memory_ptr_$",
											typeString: "function () pure returns (uint256,bytes memory)"
										}
									},
									id: 1890,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "20382:21:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_bytes_memory_ptr_$",
										typeString: "tuple(uint256,bytes memory)"
									}
								},
								functionReturnParameters: 1868,
								id: 1891,
								nodeType: "Return",
								src: "20375:28:1"
							}
						]
					},
					documentation: "As a first layer of defense we employ a max number of checks per day",
					id: 1893,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "acceptRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1863,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1846,
								name: "relay",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "19869:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1845,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "19869:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1848,
								name: "from",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "19892:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1847,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "19892:7:1",
									stateMutability: "nonpayable",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1850,
								name: "encodedFunction",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "19914:30:1",
								stateVariable: false,
								storageLocation: "calldata",
								typeDescriptions: {
									typeIdentifier: "t_bytes_calldata_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1849,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "19914:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1852,
								name: "transactionFee",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "19954:22:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1851,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "19954:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1854,
								name: "gasPrice",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "19986:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1853,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "19986:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1856,
								name: "gasLimit",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20012:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1855,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20012:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1858,
								name: "nonce",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20038:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1857,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20038:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1860,
								name: "approvalData",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20061:27:1",
								stateVariable: false,
								storageLocation: "calldata",
								typeDescriptions: {
									typeIdentifier: "t_bytes_calldata_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1859,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "20061:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1862,
								name: "maxPossibleCharge",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20098:25:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1861,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20098:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "19859:270:1"
					},
					returnParameters: {
						id: 1868,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1865,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20153:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1864,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20153:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1867,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1893,
								src: "20162:12:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1866,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "20162:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "20152:23:1"
					},
					scope: 2048,
					src: "19833:577:1",
					stateMutability: "view",
					superFunction: 3580,
					visibility: "external"
				},
				{
					body: {
						id: 1906,
						nodeType: "Block",
						src: "20478:48:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 1904,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1900,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 790,
										src: "20488:17:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1902,
												name: "max",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1895,
												src: "20515:3:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											}
										],
										expression: {
											argumentTypes: [
												{
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											],
											id: 1901,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "20508:6:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_uint40_$",
												typeString: "type(uint40)"
											},
											typeName: "uint40"
										},
										id: 1903,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "20508:11:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									src: "20488:31:1",
									typeDescriptions: {
										typeIdentifier: "t_uint40",
										typeString: "uint40"
									}
								},
								id: 1905,
								nodeType: "ExpressionStatement",
								src: "20488:31:1"
							}
						]
					},
					documentation: null,
					id: 1907,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1898,
							modifierName: {
								argumentTypes: null,
								id: 1897,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "20468:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "20468:9:1"
						}
					],
					name: "setGsnMaxCallsPerDay",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1896,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1895,
								name: "max",
								nodeType: "VariableDeclaration",
								scope: 1907,
								src: "20446:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1894,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20446:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "20445:13:1"
					},
					returnParameters: {
						id: 1899,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20478:0:1"
					},
					scope: 2048,
					src: "20416:110:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1929,
						nodeType: "Block",
						src: "20744:217:1",
						statements: [
							{
								assignments: [
									1911
								],
								declarations: [
									{
										constant: false,
										id: 1911,
										name: "curDay",
										nodeType: "VariableDeclaration",
										scope: 1929,
										src: "20755:14:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1910,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "20755:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1914,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1912,
										name: "getCurDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1946,
										src: "20772:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_uint256_$",
											typeString: "function () view returns (uint256)"
										}
									},
									id: 1913,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "20772:11:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "20755:28:1"
							},
							{
								assignments: [
									1916
								],
								declarations: [
									{
										constant: false,
										id: 1916,
										name: "curCounter",
										nodeType: "VariableDeclaration",
										scope: 1929,
										src: "20793:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1915,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "20793:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1920,
								initialValue: {
									argumentTypes: null,
									baseExpression: {
										argumentTypes: null,
										id: 1917,
										name: "gsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 788,
										src: "20814:10:1",
										typeDescriptions: {
											typeIdentifier: "t_mapping$_t_uint256_$_t_uint256_$",
											typeString: "mapping(uint256 => uint256)"
										}
									},
									id: 1919,
									indexExpression: {
										argumentTypes: null,
										id: 1918,
										name: "curDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1911,
										src: "20825:6:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									isConstant: false,
									isLValue: true,
									isPure: false,
									lValueRequested: false,
									nodeType: "IndexAccess",
									src: "20814:18:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "20793:39:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1927,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 1921,
											name: "gsnCounter",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 788,
											src: "20843:10:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_uint256_$_t_uint256_$",
												typeString: "mapping(uint256 => uint256)"
											}
										},
										id: 1923,
										indexExpression: {
											argumentTypes: null,
											id: 1922,
											name: "curDay",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1911,
											src: "20854:6:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: true,
										nodeType: "IndexAccess",
										src: "20843:18:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										commonType: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										id: 1926,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											id: 1924,
											name: "curCounter",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1916,
											src: "20864:10:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "+",
										rightExpression: {
											argumentTypes: null,
											hexValue: "31",
											id: 1925,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "20877:1:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_1_by_1",
												typeString: "int_const 1"
											},
											value: "1"
										},
										src: "20864:14:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "20843:35:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1928,
								nodeType: "ExpressionStatement",
								src: "20843:35:1"
							}
						]
					},
					documentation: "Increase the GSN Counter for today",
					id: 1930,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "increaseGsnCounter",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1908,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20732:2:1"
					},
					returnParameters: {
						id: 1909,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20744:0:1"
					},
					scope: 2048,
					src: "20705:256:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1945,
						nodeType: "Block",
						src: "21040:65:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											commonType: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											id: 1942,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1937,
														name: "now",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 10550,
														src: "21070:3:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													],
													id: 1936,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "21065:4:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint256_$",
														typeString: "type(uint256)"
													},
													typeName: "uint"
												},
												id: 1938,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "21065:9:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											},
											nodeType: "BinaryOperation",
											operator: "/",
											rightExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1940,
														name: "DAY_IN_SECONDS",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 784,
														src: "21082:14:1",
														typeDescriptions: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														}
													],
													id: 1939,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "21077:4:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint256_$",
														typeString: "type(uint256)"
													},
													typeName: "uint"
												},
												id: 1941,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "21077:20:1",
												typeDescriptions: {
													typeIdentifier: "t_uint256",
													typeString: "uint256"
												}
											},
											src: "21065:32:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										],
										id: 1935,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "21057:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1943,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21057:41:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								functionReturnParameters: 1934,
								id: 1944,
								nodeType: "Return",
								src: "21050:48:1"
							}
						]
					},
					documentation: null,
					id: 1946,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getCurDay",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1931,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21007:2:1"
					},
					returnParameters: {
						id: 1934,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1933,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1946,
								src: "21031:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1932,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "21031:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21030:9:1"
					},
					scope: 2048,
					src: "20989:116:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1953,
						nodeType: "Block",
						src: "21284:7:1",
						statements: [
						]
					},
					documentation: null,
					id: 1954,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_preRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1949,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1948,
								name: "context",
								nodeType: "VariableDeclaration",
								scope: 1954,
								src: "21235:20:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1947,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "21235:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21234:22:1"
					},
					returnParameters: {
						id: 1952,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1951,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1954,
								src: "21275:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1950,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "21275:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21274:9:1"
					},
					scope: 2048,
					src: "21210:81:1",
					stateMutability: "nonpayable",
					superFunction: 3712,
					visibility: "internal"
				},
				{
					body: {
						id: 1965,
						nodeType: "Block",
						src: "21391:7:1",
						statements: [
						]
					},
					documentation: null,
					id: 1966,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_postRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1963,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1956,
								name: "context",
								nodeType: "VariableDeclaration",
								scope: 1966,
								src: "21323:20:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1955,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "21323:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1958,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1966,
								src: "21345:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 1957,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "21345:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1960,
								name: "actualCharge",
								nodeType: "VariableDeclaration",
								scope: 1966,
								src: "21351:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1959,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "21351:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1962,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1966,
								src: "21373:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1961,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "21373:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21322:59:1"
					},
					returnParameters: {
						id: 1964,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21391:0:1"
					},
					scope: 2048,
					src: "21297:101:1",
					stateMutability: "nonpayable",
					superFunction: 3724,
					visibility: "internal"
				},
				{
					body: {
						id: 1987,
						nodeType: "Block",
						src: "21672:92:1",
						statements: [
							{
								assignments: [
									1976
								],
								declarations: [
									{
										constant: false,
										id: 1976,
										name: "relayHub",
										nodeType: "VariableDeclaration",
										scope: 1987,
										src: "21682:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_contract$_IRelayHubELA_$3548",
											typeString: "contract IRelayHubELA"
										},
										typeName: {
											contractScope: null,
											id: 1975,
											name: "IRelayHubELA",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 3548,
											src: "21682:12:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1979,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1977,
										name: "getRelayHub",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2047,
										src: "21706:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3548_$",
											typeString: "function () view returns (contract IRelayHubELA)"
										}
									},
									id: 1978,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21706:13:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3548",
										typeString: "contract IRelayHubELA"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "21682:37:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1983,
											name: "amt",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1968,
											src: "21747:3:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										{
											argumentTypes: null,
											id: 1984,
											name: "dest",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1970,
											src: "21752:4:1",
											typeDescriptions: {
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											{
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										],
										expression: {
											argumentTypes: null,
											id: 1980,
											name: "relayHub",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1976,
											src: "21729:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 1982,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "withdraw",
										nodeType: "MemberAccess",
										referencedDeclaration: 3402,
										src: "21729:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_nonpayable$_t_uint256_$_t_address_payable_$returns$__$",
											typeString: "function (uint256,address payable) external"
										}
									},
									id: 1985,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21729:28:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1986,
								nodeType: "ExpressionStatement",
								src: "21729:28:1"
							}
						]
					},
					documentation: "@dev Withdraw a specific amount of the GSNReceipient funds\n@param amt Amount of wei to withdraw\n@param dest This is the arbitrary withdrawal destination address",
					id: 1988,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1973,
							modifierName: {
								argumentTypes: null,
								id: 1972,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "21662:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "21662:9:1"
						}
					],
					name: "withdraw",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1971,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1968,
								name: "amt",
								nodeType: "VariableDeclaration",
								scope: 1988,
								src: "21620:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1967,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "21620:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							},
							{
								constant: false,
								id: 1970,
								name: "dest",
								nodeType: "VariableDeclaration",
								scope: 1988,
								src: "21633:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address_payable",
									typeString: "address payable"
								},
								typeName: {
									id: 1969,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "21633:15:1",
									stateMutability: "payable",
									typeDescriptions: {
										typeIdentifier: "t_address_payable",
										typeString: "address payable"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21619:35:1"
					},
					returnParameters: {
						id: 1974,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21672:0:1"
					},
					scope: 2048,
					src: "21602:162:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2021,
						nodeType: "Block",
						src: "21985:186:1",
						statements: [
							{
								assignments: [
									1998
								],
								declarations: [
									{
										constant: false,
										id: 1998,
										name: "relayHub",
										nodeType: "VariableDeclaration",
										scope: 2021,
										src: "21995:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_contract$_IRelayHubELA_$3548",
											typeString: "contract IRelayHubELA"
										},
										typeName: {
											contractScope: null,
											id: 1997,
											name: "IRelayHubELA",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 3548,
											src: "21995:12:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2001,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1999,
										name: "getRelayHub",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2047,
										src: "22019:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3548_$",
											typeString: "function () view returns (contract IRelayHubELA)"
										}
									},
									id: 2000,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22019:13:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3548",
										typeString: "contract IRelayHubELA"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "21995:37:1"
							},
							{
								assignments: [
									2003
								],
								declarations: [
									{
										constant: false,
										id: 2003,
										name: "balance",
										nodeType: "VariableDeclaration",
										scope: 2021,
										src: "22042:15:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 2002,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "22042:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2011,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 2008,
													name: "this",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 10603,
													src: "22092:4:1",
													typeDescriptions: {
														typeIdentifier: "t_contract$_ELAJSStore_$2048",
														typeString: "contract ELAJSStore"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_contract$_ELAJSStore_$2048",
														typeString: "contract ELAJSStore"
													}
												],
												id: 2007,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "22084:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_address_$",
													typeString: "type(address)"
												},
												typeName: "address"
											},
											id: 2009,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22084:13:1",
											typeDescriptions: {
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										],
										expression: {
											argumentTypes: null,
											"arguments": [
											],
											expression: {
												argumentTypes: [
												],
												id: 2004,
												name: "getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 2047,
												src: "22060:11:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3548_$",
													typeString: "function () view returns (contract IRelayHubELA)"
												}
											},
											id: 2005,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22060:13:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2006,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "balanceOf",
										nodeType: "MemberAccess",
										referencedDeclaration: 3395,
										src: "22060:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_view$_t_address_$returns$_t_uint256_$",
											typeString: "function (address) view external returns (uint256)"
										}
									},
									id: 2010,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22060:38:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "22042:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2015,
											name: "balance",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2003,
											src: "22126:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										{
											argumentTypes: null,
											id: 2016,
											name: "dest",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1990,
											src: "22135:4:1",
											typeDescriptions: {
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											},
											{
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										],
										expression: {
											argumentTypes: null,
											id: 2012,
											name: "relayHub",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1998,
											src: "22108:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2014,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "withdraw",
										nodeType: "MemberAccess",
										referencedDeclaration: 3402,
										src: "22108:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_nonpayable$_t_uint256_$_t_address_payable_$returns$__$",
											typeString: "function (uint256,address payable) external"
										}
									},
									id: 2017,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22108:32:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 2018,
								nodeType: "ExpressionStatement",
								src: "22108:32:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2019,
									name: "balance",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 2003,
									src: "22157:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								functionReturnParameters: 1996,
								id: 2020,
								nodeType: "Return",
								src: "22150:14:1"
							}
						]
					},
					documentation: "@dev Withdraw all the GSNReceipient funds\n@param dest This is the arbitrary withdrawal destination address",
					id: 2022,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1993,
							modifierName: {
								argumentTypes: null,
								id: 1992,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4545,
								src: "21957:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "21957:9:1"
						}
					],
					name: "withdrawAll",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1991,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1990,
								name: "dest",
								nodeType: "VariableDeclaration",
								scope: 2022,
								src: "21928:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address_payable",
									typeString: "address payable"
								},
								typeName: {
									id: 1989,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "21928:15:1",
									stateMutability: "payable",
									typeDescriptions: {
										typeIdentifier: "t_address_payable",
										typeString: "address payable"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21927:22:1"
					},
					returnParameters: {
						id: 1996,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1995,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2022,
								src: "21976:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1994,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "21976:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21975:9:1"
					},
					scope: 2048,
					src: "21907:264:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2035,
						nodeType: "Block",
						src: "22232:62:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 2031,
													name: "this",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 10603,
													src: "22281:4:1",
													typeDescriptions: {
														typeIdentifier: "t_contract$_ELAJSStore_$2048",
														typeString: "contract ELAJSStore"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_contract$_ELAJSStore_$2048",
														typeString: "contract ELAJSStore"
													}
												],
												id: 2030,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "22273:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_address_$",
													typeString: "type(address)"
												},
												typeName: "address"
											},
											id: 2032,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22273:13:1",
											typeDescriptions: {
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_address_payable",
												typeString: "address payable"
											}
										],
										expression: {
											argumentTypes: null,
											"arguments": [
											],
											expression: {
												argumentTypes: [
												],
												id: 2027,
												name: "getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 2047,
												src: "22249:11:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3548_$",
													typeString: "function () view returns (contract IRelayHubELA)"
												}
											},
											id: 2028,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22249:13:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3548",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2029,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "balanceOf",
										nodeType: "MemberAccess",
										referencedDeclaration: 3395,
										src: "22249:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_view$_t_address_$returns$_t_uint256_$",
											typeString: "function (address) view external returns (uint256)"
										}
									},
									id: 2033,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22249:38:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								functionReturnParameters: 2026,
								id: 2034,
								nodeType: "Return",
								src: "22242:45:1"
							}
						]
					},
					documentation: null,
					id: 2036,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getGSNBalance",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2023,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "22199:2:1"
					},
					returnParameters: {
						id: 2026,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2025,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2036,
								src: "22223:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 2024,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "22223:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "22222:9:1"
					},
					scope: 2048,
					src: "22177:117:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2046,
						nodeType: "Block",
						src: "22360:52:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
											],
											expression: {
												argumentTypes: [
												],
												id: 2042,
												name: "_getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 3087,
												src: "22390:12:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 2043,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22390:14:1",
											typeDescriptions: {
												typeIdentifier: "t_address",
												typeString: "address"
											}
										}
									],
									expression: {
										argumentTypes: [
											{
												typeIdentifier: "t_address",
												typeString: "address"
											}
										],
										id: 2041,
										name: "IRelayHubELA",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 3548,
										src: "22377:12:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_contract$_IRelayHubELA_$3548_$",
											typeString: "type(contract IRelayHubELA)"
										}
									},
									id: 2044,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22377:28:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3548",
										typeString: "contract IRelayHubELA"
									}
								},
								functionReturnParameters: 2040,
								id: 2045,
								nodeType: "Return",
								src: "22370:35:1"
							}
						]
					},
					documentation: null,
					id: 2047,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRelayHub",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2037,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "22320:2:1"
					},
					returnParameters: {
						id: 2040,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2039,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2047,
								src: "22346:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_contract$_IRelayHubELA_$3548",
									typeString: "contract IRelayHubELA"
								},
								typeName: {
									contractScope: null,
									id: 2038,
									name: "IRelayHubELA",
									nodeType: "UserDefinedTypeName",
									referencedDeclaration: 3548,
									src: "22346:12:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3548",
										typeString: "contract IRelayHubELA"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "22345:14:1"
					},
					scope: 2048,
					src: "22300:112:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "internal"
				}
			],
			scope: 2049,
			src: "640:21774:1"
		}
	],
	src: "0:22415:1"
};
var bytecode = "0x608060405261596a806100136000396000f3fe6080604052600436106101b5576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168062a7a56e146101b7578062f714ce146101e257806301ee810a1461020b5780631fd6dda51461023657806328343c3414610273578063287e72461461029e578063365628a2146102dc5780633c2e8599146103055780633ffe300e146103305780634102fbf6146103595780636729003c14610384578063715018a6146103c157806374e861d6146103d85780637af9c663146104035780637e03a8241461044057806380274db7146104695780638175d7eb146104a657806383947ea0146104cf5780638d3178cc1461050d5780638da5cb5b146105365780638f32d59b14610561578063a2ea7c6e1461058c578063aba99fc9146105c9578063ad61ccd514610606578063b467949b14610631578063bc41c3dd1461065a578063c2309bf914610683578063c4d66de8146106c0578063d887f105146106e9578063e06e0e2214610727578063e3c504e414610750578063ed90cb371461078d578063f201fe2a146107b6578063f2fde38b146107f3578063fa09e6301461081c575b005b3480156101c357600080fd5b506101cc610859565b6040516101d9919061561c565b60405180910390f35b3480156101ee57600080fd5b5061020960048036036102049190810190614811565b61086f565b005b34801561021757600080fd5b50610220610951565b60405161022d91906156b9565b60405180910390f35b34801561024257600080fd5b5061025d600480360361025891908101906143a3565b610968565b60405161026a91906151f7565b60405180910390f35b34801561027f57600080fd5b50610288610985565b60405161029591906151d5565b60405180910390f35b3480156102aa57600080fd5b506102c560048036036102c091908101906143a3565b6109c3565b6040516102d39291906151ac565b60405180910390f35b3480156102e857600080fd5b5061030360048036036102fe9190810190614653565b610a19565b005b34801561031157600080fd5b5061031a610b31565b604051610327919061561c565b60405180910390f35b34801561033c57600080fd5b50610357600480360361035291908101906145c4565b610be4565b005b34801561036557600080fd5b5061036e610db8565b60405161037b9190615212565b60405180910390f35b34801561039057600080fd5b506103ab60048036036103a691908101906143a3565b610ddf565b6040516103b89190615212565b60405180910390f35b3480156103cd57600080fd5b506103d6610e22565b005b3480156103e457600080fd5b506103ed610f2c565b6040516103fa9190615176565b60405180910390f35b34801561040f57600080fd5b5061042a60048036036104259190810190614408565b610f3b565b60405161043791906151f7565b60405180910390f35b34801561044c57600080fd5b506104676004803603610462919081019061454d565b610fca565b005b34801561047557600080fd5b50610490600480360361048b91908101906146fa565b61105d565b60405161049d9190615212565b60405180910390f35b3480156104b257600080fd5b506104cd60048036036104c8919081019061449b565b61112b565b005b3480156104db57600080fd5b506104f660048036036104f191908101906142a3565b61116a565b604051610504929190615689565b60405180910390f35b34801561051957600080fd5b50610534600480360361052f91908101906144ea565b6111e9565b005b34801561054257600080fd5b5061054b611283565b6040516105589190615176565b60405180910390f35b34801561056d57600080fd5b506105766112ad565b60405161058391906151f7565b60405180910390f35b34801561059857600080fd5b506105b360048036036105ae91908101906143a3565b61130c565b6040516105c091906155fa565b60405180910390f35b3480156105d557600080fd5b506105f060048036036105eb91908101906147bf565b61133d565b6040516105fd919061561c565b60405180910390f35b34801561061257600080fd5b5061061b611355565b6040516106289190615278565b60405180910390f35b34801561063d57600080fd5b506106586004803603610653919081019061454d565b611392565b005b34801561066657600080fd5b50610681600480360361067c91908101906147bf565b6115a9565b005b34801561068f57600080fd5b506106aa60048036036106a591908101906143a3565b611618565b6040516106b791906151d5565b60405180910390f35b3480156106cc57600080fd5b506106e760048036036106e29190810190614251565b611691565b005b3480156106f557600080fd5b50610710600480360361070b91908101906143a3565b611797565b60405161071e929190615637565b60405180910390f35b34801561073357600080fd5b5061074e6004803603610749919081019061473f565b61182c565b005b34801561075c57600080fd5b50610777600480360361077291908101906143a3565b6118fa565b6040516107849190615256565b60405180910390f35b34801561079957600080fd5b506107b460048036036107af91908101906143cc565b61196d565b005b3480156107c257600080fd5b506107dd60048036036107d891908101906143cc565b611a25565b6040516107ea91906151f7565b60405180910390f35b3480156107ff57600080fd5b5061081a60048036036108159190810190614251565b611a45565b005b34801561082857600080fd5b50610843600480360361083e919081019061427a565b611a9a565b604051610850919061561c565b60405180910390f35b6000620151804281151561086957fe5b04905090565b6108776112ad565b15156108b8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016108af9061545a565b60405180910390fd5b60006108c2611c33565b90508073ffffffffffffffffffffffffffffffffffffffff1662f714ce84846040518363ffffffff167c010000000000000000000000000000000000000000000000000000000002815260040161091a929190615660565b600060405180830381600087803b15801561093457600080fd5b505af1158015610948573d6000803e3d6000fd5b50505050505050565b606760009054906101000a900464ffffffffff1681565b600061097e82606c611c4290919063ffffffff16565b9050919050565b60606109be7f736368656d61732e7075626c69632e7461626c65730000000000000000000000600102606c611cb990919063ffffffff16565b905090565b60008060006109dc84606c611cd990919063ffffffff16565b600190049050807c0100000000000000000000000000000000000000000000000000000000029150602081908060020a8204915050925050915091565b610a216112ad565b1515610a62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a599061545a565b60405180910390fd5b60006001026068600086815260200190815260200160002054141515610abd576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610ab49061551a565b60405180910390fd5b6000809050610acd858583611cf9565b610b067f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010287606c611da59092919063ffffffff16565b50610b1b856069611ed090919063ffffffff16565b50610b2886868585610f3b565b50505050505050565b6000610b3b611c33565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610b8f9190615191565b60206040518083038186803b158015610ba757600080fd5b505afa158015610bbb573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250610bdf91908101906147e8565b905090565b84600080610bf183611797565b91509150600082111515610c3a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610c319061533a565b60405180910390fd5b6001821180610c54575060011515610c506112ad565b1515145b80610c915750610c62611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515610cd2576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610cc99061541a565b60405180910390fd5b6000610cde888a611f44565b90506000610cec8883611f44565b905060001515610d0682606c611c4290919063ffffffff16565b1515141515610d4a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610d419061549a565b60405180910390fd5b610d52611fa1565b610d688a886069611fe49092919063ffffffff16565b5060001515610d8183606c611c4290919063ffffffff16565b15151415610d9557610d9482888c61202f565b5b610dab8187606c6120df9092919063ffffffff16565b5050505050505050505050565b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010281565b6000610df582606c611c4290919063ffffffff16565b15610e1557610e0e82606c611cd990919063ffffffff16565b9050610e1d565b600060010290505b919050565b610e2a6112ad565b1515610e6b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610e629061545a565b60405180910390fd5b600073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a36000603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550565b6000610f3661220a565b905090565b6000610f456112ad565b1515610f86576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610f7d9061545a565b60405180910390fd5b610f8e613f54565b610f9986858561223b565b90506060610fa6826122b8565b9050610fbe8682606c6120df9092919063ffffffff16565b92505050949350505050565b6000610fd68587611f44565b90506000610fe48583611f44565b9050610ff287878487612388565b610ffa611fa1565b6110108184606c6125e39092919063ffffffff16565b508285887f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718761103e611ef0565b60405161104c92919061522d565b60405180910390a450505050505050565b6000611067610f2c565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156110d6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016110cd906152ba565b60405180910390fd5b61112383838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505061270e565b905092915050565b60006111378385611f44565b905061114584828585612715565b61114d611fa1565b611163848360696129699092919063ffffffff16565b5050505050565b600060606000611178610859565b9050600060666000838152602001908152602001600020549050606760009054906101000a900464ffffffffff1664ffffffffff16811015156111ca576111bf600b6129b4565b9350935050506111d9565b6111d26129d6565b9350935050505b9b509b9950505050505050505050565b60006111f58486611f44565b905060006112038483611f44565b905061121186838786612715565b611219611fa1565b600061122f82606c6129fb90919063ffffffff16565b90506001151581151514151561127a576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016112719061543a565b60405180910390fd5b50505050505050565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16905090565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166112f0611ef0565b73ffffffffffffffffffffffffffffffffffffffff1614905090565b611314613f54565b606061132a83606c612a7290919063ffffffff16565b905061133581612a92565b915050919050565b60666020528060005260406000206000915090505481565b60606040805190810160405280600581526020017f312e302e30000000000000000000000000000000000000000000000000000000815250905090565b8460008061139f83611797565b915091506000821115156113e8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016113df9061533a565b60405180910390fd5b60018211806114025750600115156113fe6112ad565b1515145b8061143f5750611410611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515611480576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016114779061541a565b60405180910390fd5b600061148c888a611f44565b9050600061149a8883611f44565b9050600015156114b482606c611c4290919063ffffffff16565b15151415156114f8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016114ef9061549a565b60405180910390fd5b611500611fa1565b6115168a886069611fe49092919063ffffffff16565b506000151561152f83606c611c4290919063ffffffff16565b151514156115435761154282888c61202f565b5b6115598187606c6125e39092919063ffffffff16565b5085888b7f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718a611587611ef0565b60405161159592919061522d565b60405180910390a450505050505050505050565b6115b16112ad565b15156115f2576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115e99061545a565b60405180910390fd5b80606760006101000a81548164ffffffffff021916908364ffffffffff16021790555050565b606060011515611632836069612b3b90919063ffffffff16565b1515141515611676576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161166d9061555a565b60405180910390fd5b61168a826069612b5b90919063ffffffff16565b9050919050565b600060019054906101000a900460ff16806116b057506116af612bca565b5b806116c757506000809054906101000a900460ff16155b1515611708576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016116ff9061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015611758576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b61176133612be1565b61176a82612d8b565b611772612e80565b80156117935760008060016101000a81548160ff0219169083151502179055505b5050565b600080600060010260686000858152602001908152602001600020541115156117f5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016117ec906155ba565b60405180910390fd5b600060686000858152602001908152602001600020546001900490508060ff169250600881908060020a8204915050915050915091565b611834610f2c565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156118a3576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161189a906152ba565b60405180910390fd5b6118f385858080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050848484612ee2565b5050505050565b606061191082606c611c4290919063ffffffff16565b156119305761192982606c612a7290919063ffffffff16565b9050611968565b60006040519080825280601f01601f1916602001820160405280156119645781602001600182028038833980820191505090505b5090505b919050565b6119756112ad565b15156119b6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016119ad9061545a565b60405180910390fd5b60006001026068600083815260200190815260200160002081905550611a0b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010283606c612ee89092919063ffffffff16565b50611a20816069612f0b90919063ffffffff16565b505050565b6000611a3d83836069612f449092919063ffffffff16565b905092915050565b611a4d6112ad565b1515611a8e576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611a859061545a565b60405180910390fd5b611a9781612f8f565b50565b6000611aa46112ad565b1515611ae5576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611adc9061545a565b60405180910390fd5b6000611aef611c33565b90506000611afb611c33565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611b4f9190615191565b60206040518083038186803b158015611b6757600080fd5b505afa158015611b7b573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611b9f91908101906147e8565b90508173ffffffffffffffffffffffffffffffffffffffff1662f714ce82866040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611bf7929190615660565b600060405180830381600087803b158015611c1157600080fd5b505af1158015611c25573d6000803e3d6000fd5b505050508092505050919050565b6000611c3d61220a565b905090565b6000611c5a82846000016130c190919063ffffffff16565b80611c775750611c7682846003016130e190919063ffffffff16565b5b80611c945750611c938284600601612b3b90919063ffffffff16565b5b80611cb15750611cb0828460090161310190919063ffffffff16565b5b905092915050565b6060611cd18284600601612b5b90919063ffffffff16565b905092915050565b6000611cf1828460000161312190919063ffffffff16565b905092915050565b611d016112ad565b1515611d42576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611d399061545a565b60405180910390fd5b60008260ff168117905060088273ffffffffffffffffffffffffffffffffffffffff169060020a0273ffffffffffffffffffffffffffffffffffffffff168117905080600102606860008681526020019081526020016000208190555050505050565b6000611dbd83856000016130c190919063ffffffff16565b151515611dff576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611df69061539a565b60405180910390fd5b611e1583856003016130e190919063ffffffff16565b151515611e57576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611e4e9061539a565b60405180910390fd5b611e6d838560090161310190919063ffffffff16565b151515611eaf576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611ea69061539a565b60405180910390fd5b611ec7838386600601611fe49092919063ffffffff16565b90509392505050565b6000611ee8828460010161318c90919063ffffffff16565b905092915050565b6000611efa61220a565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16141515611f3657339050611f41565b611f3e6131f8565b90505b90565b60006060604080519080825280601f01601f191660200182016040528015611f7b5781602001600182028038833980820191505090505b509050836040820152826020820152600081805190602001209050809250505092915050565b6000611fab610859565b90506000606660008381526020019081526020016000205490506001810160666000848152602001908152602001600020819055505050565b6000611ff08484612b3b565b156120235761201c8285600001600086815260200190815260200160002061318c90919063ffffffff16565b9050612028565b600090505b9392505050565b6000151561204784606c611c4290919063ffffffff16565b151514151561208b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612082906153ba565b60405180910390fd5b60004263ffffffff16905060206120a0611ef0565b73ffffffffffffffffffffffffffffffffffffffff169060020a02811790506120d88482600102606c6125e39092919063ffffffff16565b5050505050565b60006120f783856000016130c190919063ffffffff16565b151515612139576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121309061539a565b60405180910390fd5b61214f8385600601612b3b90919063ffffffff16565b151515612191576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121889061539a565b60405180910390fd5b6121a7838560090161310190919063ffffffff16565b1515156121e9576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121e09061539a565b60405180910390fd5b6122018383866003016132709092919063ffffffff16565b90509392505050565b6000807f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050805491505090565b612243613f54565b81518351141515612289576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612280906153da565b60405180910390fd5b612291613f54565b848160000181815250506122a584846132bb565b8160200181905250809150509392505050565b606060006122c5836133d1565b90506060816040519080825280601f01601f1916602001820160405280156122fc5781602001600182028038833980820191505090505b509050612318828286600001516133ec9092919063ffffffff16565b602082039150612337828286602001516133f69092919063ffffffff16565b915060008214151561237e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016123759061529a565b60405180910390fd5b8092505050919050565b600115156123a285836069612f449092919063ffffffff16565b15151415156123e6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016123dd9061559a565b60405180910390fd5b6000806123f286611797565b9150915060008211151561243b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612432906152fa565b60405180910390fd5b60018211806124555750600115156124516112ad565b1515145b806124925750612463611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15156124d3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016124ca9061537a565b60405180910390fd5b6002821015156125db5760006124f385606c611cd990919063ffffffff16565b9050600060208260019004908060020a82049150509050612512611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16141561254a576125d8565b600115156125566112ad565b151514806125965750612567611ef0565b73ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16145b15156125d7576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016125ce906153fa565b60405180910390fd5b5b50505b505050505050565b60006125fb83856003016130e190919063ffffffff16565b15151561263d576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016126349061539a565b60405180910390fd5b6126538385600601612b3b90919063ffffffff16565b151515612695576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161268c9061539a565b60405180910390fd5b6126ab838560090161310190919063ffffffff16565b1515156126ed576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016126e49061539a565b60405180910390fd5b6127058383866000016134b39092919063ffffffff16565b90509392505050565b6000919050565b6001151561272f85836069612f449092919063ffffffff16565b1515141515612773576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161276a9061553a565b60405180910390fd5b60008061277f86611797565b915091506000821115156127c8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016127bf906152da565b60405180910390fd5b60018211806127e25750600115156127de6112ad565b1515145b8061281f57506127f0611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612860576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612857906154ba565b60405180910390fd5b600282101515612961576128726112ad565b806128af5750612880611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b156128b957612960565b60006128cf86606c611cd990919063ffffffff16565b9050600060208260019004908060020a820491505090506128ee611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151561295d576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612954906155da565b60405180910390fd5b50505b5b505050505050565b60006129758484612b3b565b156129a8576129a1828560000160008681526020019081526020016000206134ee90919063ffffffff16565b90506129ad565b600090505b9392505050565b6000606082600b01602060405190810160405280600081525091509150915091565b600060606129f360206040519081016040528060008152506135e7565b915091509091565b6000612a1382846000016135f790919063ffffffff16565b80612a305750612a2f828460030161364990919063ffffffff16565b5b80612a4d5750612a4c8284600601612f0b90919063ffffffff16565b5b80612a6a5750612a6982846009016136a390919063ffffffff16565b5b905092915050565b6060612a8a82846003016136dc90919063ffffffff16565b905092915050565b612a9a613f54565b600082519050612aa8613f54565b612abb82856137df90919063ffffffff16565b816000018181525050602082039150612add82856137ed90919063ffffffff16565b819150826020018194508290525050600082141515612b31576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612b289061529a565b60405180910390fd5b8092505050919050565b6000612b5382846001016138f890919063ffffffff16565b905092915050565b6060612b678383612b3b565b15612b9057612b8983600001600084815260200190815260200160002061391b565b9050612bc4565b6000604051908082528060200260200182016040528015612bc05781602001602082028038833980820191505090505b5090505b92915050565b6000803090506000813b9050600081149250505090565b600060019054906101000a900460ff1680612c005750612bff612bca565b5b80612c1757506000809054906101000a900460ff16155b1515612c58576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c4f9061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015612ca8576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16600073ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a38015612d875760008060016101000a81548160ff0219169083151502179055505b5050565b600060019054906101000a900460ff1680612daa5750612da9612bca565b5b80612dc157506000809054906101000a900460ff16155b1515612e02576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612df99061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015612e52576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b612e5b826139b8565b8015612e7c5760008060016101000a81548160ff0219169083151502179055505b5050565b6103e8606760006101000a81548164ffffffffff021916908364ffffffffff160217905550612edf7f736368656d61732e7075626c69632e7461626c657300000000000000000000006001026000606c613aad9092919063ffffffff16565b50565b50505050565b6000612f028383866006016129699092919063ffffffff16565b90509392505050565b6000612f178383612b3b565b15612f3957612f3282846001016134ee90919063ffffffff16565b9050612f3e565b600090505b92915050565b6000612f508484612b3b565b15612f8357612f7c828560000160008681526020019081526020016000206138f890919063ffffffff16565b9050612f88565b600090505b9392505050565b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151515613001576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ff89061531a565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a380603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b60006130d982846001016138f890919063ffffffff16565b905092915050565b60006130f982846001016138f890919063ffffffff16565b905092915050565b600061311982846001016138f890919063ffffffff16565b905092915050565b600061312d83836130c1565b151561316e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016131659061557a565b60405180910390fd5b82600001600083815260200190815260200160002054905092915050565b600061319883836138f8565b15156131ed5782600101829080600181540180825580915050906001820390600052602060002001600090919290919091505583600001600084815260200190815260200160002081905550600190506131f2565b600090505b92915050565b600060606000368080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509050600080369050905073ffffffffffffffffffffffffffffffffffffffff81830151169250829250505090565b600081846000016000858152602001908152602001600020908051906020019061329b929190613f71565b506132b2838560010161318c90919063ffffffff16565b90509392505050565b606081518351141515613303576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016132fa906153da565b60405180910390fd5b6060835160405190808252806020026020018201604052801561334057816020015b61332d613ff1565b8152602001906001900390816133255790505b50905060008090505b84518110156133c65761335a614011565b858281518110151561336857fe5b90602001906020020151816000018181525050848281518110151561338957fe5b906020019060200201518160200181815250508083838151811015156133ab57fe5b90602001906020020181905250508080600101915050613349565b508091505092915050565b60006133e08260200151613d95565b60208001019050919050565b8282820152505050565b600080839050613419818461340a88613d95565b613da39092919063ffffffff16565b60208103905060008090505b85518110156134a75761345e8285888481518110151561344157fe5b90602001906020020151600001516133ec9092919063ffffffff16565b6020820391506134948285888481518110151561347757fe5b90602001906020020151602001516133ec9092919063ffffffff16565b6020820391508080600101915050613425565b50809150509392505050565b600081846000016000858152602001908152602001600020819055506134e5838560010161318c90919063ffffffff16565b90509392505050565b60006134fa83836138f8565b156135dc5760006001846000016000858152602001908152602001600020540390506000600185600101805490500390508181141515613593576000856001018281548110151561354757fe5b9060005260206000200154905080866001018481548110151561356657fe5b90600052602060002001819055506001830186600001600083815260200190815260200160002081905550505b846000016000858152602001908152602001600020600090558460010180548015156135bb57fe5b600190038181906000526020600020016000905590556001925050506135e1565b600090505b92915050565b6000606060008391509150915091565b600061360383836130c1565b1561363e578260000160008381526020019081526020016000206000905561363782846001016134ee90919063ffffffff16565b9050613643565b600090505b92915050565b600061365583836130e1565b1561369857826000016000838152602001908152602001600020600061367b9190614031565b61369182846001016134ee90919063ffffffff16565b905061369d565b600090505b92915050565b60006136af8383613101565b156136d1576136ca82846001016134ee90919063ffffffff16565b90506136d6565b600090505b92915050565b60606136e883836130e1565b1515613729576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016137209061557a565b60405180910390fd5b8260000160008381526020019081526020016000208054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156137d25780601f106137a7576101008083540402835291602001916137d2565b820191906000526020600020905b8154815290600101906020018083116137b557829003601f168201915b5050505050905092915050565b600081830151905092915050565b6060600080839050600061380a8287613dad90919063ffffffff16565b9050602082039150600060408281151561382057fe5b04905060608160405190808252806020026020018201604052801561385f57816020015b61384c613ff1565b8152602001906001900390816138445790505b50905060008090505b828110156138e657613878614011565b61388b868b6137df90919063ffffffff16565b8160000181815250506020860395506138ad868b6137df90919063ffffffff16565b8160200181815250506020860395508083838151811015156138cb57fe5b90602001906020020181905250508080600101915050613868565b50808495509550505050509250929050565b600080836000016000848152602001908152602001600020541415905092915050565b60608082600101805490506040519080825280602002602001820160405280156139545781602001602082028038833980820191505090505b50905060005b83600101805490508110156139ae57836001018181548110151561397a57fe5b9060005260206000200154828281518110151561399357fe5b9060200190602002018181525050808060010191505061395a565b5080915050919050565b600060019054906101000a900460ff16806139d757506139d6612bca565b5b806139ee57506000809054906101000a900460ff16155b1515613a2f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a269061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015613a7f576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b613a8882613dbb565b8015613aa95760008060016101000a81548160ff0219169083151502179055505b5050565b60006004826003811115613abd57fe5b60ff16101515613b02576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613af9906154fa565b60405180910390fd5b613b1883856000016130c190919063ffffffff16565b151515613b5a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613b519061539a565b60405180910390fd5b613b7083856003016130e190919063ffffffff16565b151515613bb2576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ba99061539a565b60405180910390fd5b613bc88385600601612b3b90919063ffffffff16565b151515613c0a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c019061539a565b60405180910390fd5b613c20838560090161310190919063ffffffff16565b151515613c62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c599061539a565b60405180910390fd5b816003811115613c6e57fe5b60006003811115613c7b57fe5b1415613c9e57613c978385600601611ed090919063ffffffff16565b9050613d8e565b816003811115613caa57fe5b60016003811115613cb757fe5b1415613cda57613cd38385600901613f3490919063ffffffff16565b9050613d8e565b816003811115613ce657fe5b60026003811115613cf357fe5b1415613d1c57613d15836000600102866000016134b39092919063ffffffff16565b9050613d8e565b816003811115613d2857fe5b600380811115613d3457fe5b1415613d8d57613d868360006040519080825280601f01601f191660200182016040528015613d725781602001600182028038833980820191505090505b50866003016132709092919063ffffffff16565b9050613d8e565b5b9392505050565b600060408251029050919050565b8282820152505050565b600081830151905092915050565b6000613dc561220a565b9050600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515613e39576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613e30906154da565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515613eaa576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ea19061535a565b60405180910390fd5b8173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167fb9f84b8e65164b14439ae3620df0a4d8786d896996c0282b683f9d8c08f046e860405160405180910390a360007f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050828155505050565b6000613f4c828460010161318c90919063ffffffff16565b905092915050565b604080519081016040528060008019168152602001606081525090565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10613fb257805160ff1916838001178555613fe0565b82800160010185558215613fe0579182015b82811115613fdf578251825591602001919060010190613fc4565b5b509050613fed9190614079565b5090565b604080519081016040528060008019168152602001600080191681525090565b604080519081016040528060008019168152602001600080191681525090565b50805460018160011615610100020316600290046000825580601f106140575750614076565b601f0160209004906000526020600020908101906140759190614079565b5b50565b61409b91905b8082111561409757600081600090555060010161407f565b5090565b90565b60006140aa8235615856565b905092915050565b60006140be8235615868565b905092915050565b600082601f83011215156140d957600080fd5b81356140ec6140e782615701565b6156d4565b9150818183526020840193506020810190508385602084028201111561411157600080fd5b60005b838110156141415781614127888261415f565b845260208401935060208301925050600181019050614114565b5050505092915050565b6000614157823561587a565b905092915050565b600061416b8235615886565b905092915050565b60008083601f840112151561418757600080fd5b8235905067ffffffffffffffff8111156141a057600080fd5b6020830191508360018202830111156141b857600080fd5b9250929050565b600082601f83011215156141d257600080fd5b81356141e56141e082615729565b6156d4565b9150808252602083016020830185838301111561420157600080fd5b61420c8382846158dd565b50505092915050565b60006142218235615890565b905092915050565b60006142358251615890565b905092915050565b6000614249823561589a565b905092915050565b60006020828403121561426357600080fd5b60006142718482850161409e565b91505092915050565b60006020828403121561428c57600080fd5b600061429a848285016140b2565b91505092915050565b60008060008060008060008060008060006101208c8e0312156142c557600080fd5b60006142d38e828f0161409e565b9b505060206142e48e828f0161409e565b9a505060408c013567ffffffffffffffff81111561430157600080fd5b61430d8e828f01614173565b995099505060606143208e828f01614215565b97505060806143318e828f01614215565b96505060a06143428e828f01614215565b95505060c06143538e828f01614215565b94505060e08c013567ffffffffffffffff81111561437057600080fd5b61437c8e828f01614173565b93509350506101006143908e828f01614215565b9150509295989b509295989b9093969950565b6000602082840312156143b557600080fd5b60006143c38482850161415f565b91505092915050565b600080604083850312156143df57600080fd5b60006143ed8582860161415f565b92505060206143fe8582860161415f565b9150509250929050565b6000806000806080858703121561441e57600080fd5b600061442c8782880161415f565b945050602061443d8782880161415f565b935050604085013567ffffffffffffffff81111561445a57600080fd5b614466878288016140c6565b925050606085013567ffffffffffffffff81111561448357600080fd5b61448f878288016140c6565b91505092959194509250565b6000806000606084860312156144b057600080fd5b60006144be8682870161415f565b93505060206144cf8682870161415f565b92505060406144e08682870161415f565b9150509250925092565b6000806000806080858703121561450057600080fd5b600061450e8782880161415f565b945050602061451f8782880161415f565b93505060406145308782880161415f565b92505060606145418782880161415f565b91505092959194509250565b600080600080600060a0868803121561456557600080fd5b60006145738882890161415f565b95505060206145848882890161415f565b94505060406145958882890161415f565b93505060606145a68882890161415f565b92505060806145b78882890161415f565b9150509295509295909350565b600080600080600060a086880312156145dc57600080fd5b60006145ea8882890161415f565b95505060206145fb8882890161415f565b945050604061460c8882890161415f565b935050606061461d8882890161415f565b925050608086013567ffffffffffffffff81111561463a57600080fd5b614646888289016141bf565b9150509295509295909350565b600080600080600060a0868803121561466b57600080fd5b60006146798882890161415f565b955050602061468a8882890161415f565b945050604061469b8882890161423d565b935050606086013567ffffffffffffffff8111156146b857600080fd5b6146c4888289016140c6565b925050608086013567ffffffffffffffff8111156146e157600080fd5b6146ed888289016140c6565b9150509295509295909350565b6000806020838503121561470d57600080fd5b600083013567ffffffffffffffff81111561472757600080fd5b61473385828601614173565b92509250509250929050565b60008060008060006080868803121561475757600080fd5b600086013567ffffffffffffffff81111561477157600080fd5b61477d88828901614173565b955095505060206147908882890161414b565b93505060406147a188828901614215565b92505060606147b28882890161415f565b9150509295509295909350565b6000602082840312156147d157600080fd5b60006147df84828501614215565b91505092915050565b6000602082840312156147fa57600080fd5b600061480884828501614229565b91505092915050565b6000806040838503121561482457600080fd5b600061483285828601614215565b9250506020614843858286016140b2565b9150509250929050565b614856816158a7565b82525050565b614865816157c7565b82525050565b614874816157b5565b82525050565b60006148858261576f565b80845260208401935061489783615755565b60005b828110156148c9576148ad86835161493f565b6148b68261579b565b915060208601955060018101905061489a565b50849250505092915050565b60006148e08261577a565b8084526020840193506148f283615762565b60005b82811015614924576149088683516150ec565b614911826157a8565b91506040860195506001810190506148f5565b50849250505092915050565b614939816157d9565b82525050565b614948816157e5565b82525050565b614957816157ef565b82525050565b600061496882615785565b80845261497c8160208601602086016158ec565b6149858161591f565b602085010191505092915050565b600061499e82615790565b8084526149b28160208601602086016158ec565b6149bb8161591f565b602085010191505092915050565b6000601c82527f456e636f64696e67204572726f723a206f666673657420213d20302e000000006020830152604082019050919050565b6000602682527f47534e426f756e636572426173653a2063616c6c6572206973206e6f7420526560208301527f6c617948756200000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65006020830152604082019050919050565b6000601a82527f43616e6e6f74205550444154452073797374656d207461626c650000000000006020830152604082019050919050565b6000602682527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160208301527f64647265737300000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65006020830152604082019050919050565b6000602b82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f63757272656e74206f6e650000000000000000000000000000000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20555044415445206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602082527f4572726f723a206b65792065786973747320696e206f7468657220646963742e6020830152604082019050919050565b6000601582527f726f7720616c726561647920686173206f776e657200000000000000000000006020830152604082019050919050565b6000601082527f4572726f7220616c69676e6d656e742e000000000000000000000000000000006020830152604082019050919050565b6000603982527f4e6f7420726f774f776e6572206f72206f776e65722f64656c6567617465206660208301527f6f722055504441544520696e746f2074686973207461626c65000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20494e53455254206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000601282527f6572726f722072656d6f76696e67206b657900000000000000000000000000006020830152604082019050919050565b6000602082527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726020830152604082019050919050565b6000602e82527f436f6e747261637420696e7374616e63652068617320616c726561647920626560208301527f656e20696e697469616c697a65640000000000000000000000000000000000006040830152606082019050919050565b6000601782527f69642b6669656c6420616c7265616479206578697374730000000000000000006020830152604082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e2044454c455445206660208301527f726f6d2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602c82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f7a65726f206164647265737300000000000000000000000000000000000000006040830152606082019050919050565b6000601382527f496e76616c6964207461626c65207479706521000000000000000000000000006020830152604082019050919050565b6000601482527f5461626c6520616c7265616479206578697374730000000000000000000000006020830152604082019050919050565b6000601082527f696420646f65736e2774206578697374000000000000000000000000000000006020830152604082019050919050565b6000601182527f7461626c65206e6f7420637265617465640000000000000000000000000000006020830152604082019050919050565b6000601382527f4b657920646f6573206e6f7420657869737421000000000000000000000000006020830152604082019050919050565b6000601c82527f696420646f65736e27742065786973742c2075736520494e53455254000000006020830152604082019050919050565b6000601482527f7461626c6520646f6573206e6f742065786973740000000000000000000000006020830152604082019050919050565b6000601782527f53656e646572206e6f74206f776e6572206f6620726f770000000000000000006020830152604082019050919050565b604082016000820151615102600085018261493f565b506020820151615115602085018261493f565b50505050565b6000604083016000830151615133600086018261493f565b506020830151848203602086015261514b82826148d5565b9150508091505092915050565b6151618161583b565b82525050565b61517081615845565b82525050565b600060208201905061518b600083018461486b565b92915050565b60006020820190506151a6600083018461484d565b92915050565b60006040820190506151c1600083018561486b565b6151ce602083018461494e565b9392505050565b600060208201905081810360008301526151ef818461487a565b905092915050565b600060208201905061520c6000830184614930565b92915050565b6000602082019050615227600083018461493f565b92915050565b6000604082019050615242600083018561493f565b61524f602083018461486b565b9392505050565b60006020820190508181036000830152615270818461495d565b905092915050565b600060208201905081810360008301526152928184614993565b905092915050565b600060208201905081810360008301526152b3816149c9565b9050919050565b600060208201905081810360008301526152d381614a00565b9050919050565b600060208201905081810360008301526152f381614a5d565b9050919050565b6000602082019050818103600083015261531381614a94565b9050919050565b6000602082019050818103600083015261533381614acb565b9050919050565b6000602082019050818103600083015261535381614b28565b9050919050565b6000602082019050818103600083015261537381614b5f565b9050919050565b6000602082019050818103600083015261539381614bbc565b9050919050565b600060208201905081810360008301526153b381614c19565b9050919050565b600060208201905081810360008301526153d381614c50565b9050919050565b600060208201905081810360008301526153f381614c87565b9050919050565b6000602082019050818103600083015261541381614cbe565b9050919050565b6000602082019050818103600083015261543381614d1b565b9050919050565b6000602082019050818103600083015261545381614d78565b9050919050565b6000602082019050818103600083015261547381614daf565b9050919050565b6000602082019050818103600083015261549381614de6565b9050919050565b600060208201905081810360008301526154b381614e43565b9050919050565b600060208201905081810360008301526154d381614e7a565b9050919050565b600060208201905081810360008301526154f381614ed7565b9050919050565b6000602082019050818103600083015261551381614f34565b9050919050565b6000602082019050818103600083015261553381614f6b565b9050919050565b6000602082019050818103600083015261555381614fa2565b9050919050565b6000602082019050818103600083015261557381614fd9565b9050919050565b6000602082019050818103600083015261559381615010565b9050919050565b600060208201905081810360008301526155b381615047565b9050919050565b600060208201905081810360008301526155d38161507e565b9050919050565b600060208201905081810360008301526155f3816150b5565b9050919050565b60006020820190508181036000830152615614818461511b565b905092915050565b60006020820190506156316000830184615158565b92915050565b600060408201905061564c6000830185615158565b615659602083018461486b565b9392505050565b60006040820190506156756000830185615158565b615682602083018461485c565b9392505050565b600060408201905061569e6000830185615158565b81810360208301526156b0818461495d565b90509392505050565b60006020820190506156ce6000830184615167565b92915050565b6000604051905081810181811067ffffffffffffffff821117156156f757600080fd5b8060405250919050565b600067ffffffffffffffff82111561571857600080fd5b602082029050602081019050919050565b600067ffffffffffffffff82111561574057600080fd5b601f19601f8301169050602081019050919050565b6000602082019050919050565b6000602082019050919050565b600081519050919050565b600081519050919050565b600081519050919050565b600081519050919050565b6000602082019050919050565b6000602082019050919050565b60006157c08261581b565b9050919050565b60006157d28261581b565b9050919050565b60008115159050919050565b6000819050919050565b60007fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000819050919050565b600064ffffffffff82169050919050565b60006158618261581b565b9050919050565b60006158738261581b565b9050919050565b60008115159050919050565b6000819050919050565b6000819050919050565b600060ff82169050919050565b60006158b2826158b9565b9050919050565b60006158c4826158cb565b9050919050565b60006158d68261581b565b9050919050565b82818337600083830152505050565b60005b8381101561590a5780820151818401526020810190506158ef565b83811115615919576000848401525b50505050565b6000601f19601f830116905091905056fea265627a7a723058204adf0a4d4d7fd656a78155f129f8697c6a17c9ce00b2b0657209b16fb78e194d6c6578706572696d656e74616cf50037";
var deployedBytecode = "0x6080604052600436106101b5576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168062a7a56e146101b7578062f714ce146101e257806301ee810a1461020b5780631fd6dda51461023657806328343c3414610273578063287e72461461029e578063365628a2146102dc5780633c2e8599146103055780633ffe300e146103305780634102fbf6146103595780636729003c14610384578063715018a6146103c157806374e861d6146103d85780637af9c663146104035780637e03a8241461044057806380274db7146104695780638175d7eb146104a657806383947ea0146104cf5780638d3178cc1461050d5780638da5cb5b146105365780638f32d59b14610561578063a2ea7c6e1461058c578063aba99fc9146105c9578063ad61ccd514610606578063b467949b14610631578063bc41c3dd1461065a578063c2309bf914610683578063c4d66de8146106c0578063d887f105146106e9578063e06e0e2214610727578063e3c504e414610750578063ed90cb371461078d578063f201fe2a146107b6578063f2fde38b146107f3578063fa09e6301461081c575b005b3480156101c357600080fd5b506101cc610859565b6040516101d9919061561c565b60405180910390f35b3480156101ee57600080fd5b5061020960048036036102049190810190614811565b61086f565b005b34801561021757600080fd5b50610220610951565b60405161022d91906156b9565b60405180910390f35b34801561024257600080fd5b5061025d600480360361025891908101906143a3565b610968565b60405161026a91906151f7565b60405180910390f35b34801561027f57600080fd5b50610288610985565b60405161029591906151d5565b60405180910390f35b3480156102aa57600080fd5b506102c560048036036102c091908101906143a3565b6109c3565b6040516102d39291906151ac565b60405180910390f35b3480156102e857600080fd5b5061030360048036036102fe9190810190614653565b610a19565b005b34801561031157600080fd5b5061031a610b31565b604051610327919061561c565b60405180910390f35b34801561033c57600080fd5b50610357600480360361035291908101906145c4565b610be4565b005b34801561036557600080fd5b5061036e610db8565b60405161037b9190615212565b60405180910390f35b34801561039057600080fd5b506103ab60048036036103a691908101906143a3565b610ddf565b6040516103b89190615212565b60405180910390f35b3480156103cd57600080fd5b506103d6610e22565b005b3480156103e457600080fd5b506103ed610f2c565b6040516103fa9190615176565b60405180910390f35b34801561040f57600080fd5b5061042a60048036036104259190810190614408565b610f3b565b60405161043791906151f7565b60405180910390f35b34801561044c57600080fd5b506104676004803603610462919081019061454d565b610fca565b005b34801561047557600080fd5b50610490600480360361048b91908101906146fa565b61105d565b60405161049d9190615212565b60405180910390f35b3480156104b257600080fd5b506104cd60048036036104c8919081019061449b565b61112b565b005b3480156104db57600080fd5b506104f660048036036104f191908101906142a3565b61116a565b604051610504929190615689565b60405180910390f35b34801561051957600080fd5b50610534600480360361052f91908101906144ea565b6111e9565b005b34801561054257600080fd5b5061054b611283565b6040516105589190615176565b60405180910390f35b34801561056d57600080fd5b506105766112ad565b60405161058391906151f7565b60405180910390f35b34801561059857600080fd5b506105b360048036036105ae91908101906143a3565b61130c565b6040516105c091906155fa565b60405180910390f35b3480156105d557600080fd5b506105f060048036036105eb91908101906147bf565b61133d565b6040516105fd919061561c565b60405180910390f35b34801561061257600080fd5b5061061b611355565b6040516106289190615278565b60405180910390f35b34801561063d57600080fd5b506106586004803603610653919081019061454d565b611392565b005b34801561066657600080fd5b50610681600480360361067c91908101906147bf565b6115a9565b005b34801561068f57600080fd5b506106aa60048036036106a591908101906143a3565b611618565b6040516106b791906151d5565b60405180910390f35b3480156106cc57600080fd5b506106e760048036036106e29190810190614251565b611691565b005b3480156106f557600080fd5b50610710600480360361070b91908101906143a3565b611797565b60405161071e929190615637565b60405180910390f35b34801561073357600080fd5b5061074e6004803603610749919081019061473f565b61182c565b005b34801561075c57600080fd5b50610777600480360361077291908101906143a3565b6118fa565b6040516107849190615256565b60405180910390f35b34801561079957600080fd5b506107b460048036036107af91908101906143cc565b61196d565b005b3480156107c257600080fd5b506107dd60048036036107d891908101906143cc565b611a25565b6040516107ea91906151f7565b60405180910390f35b3480156107ff57600080fd5b5061081a60048036036108159190810190614251565b611a45565b005b34801561082857600080fd5b50610843600480360361083e919081019061427a565b611a9a565b604051610850919061561c565b60405180910390f35b6000620151804281151561086957fe5b04905090565b6108776112ad565b15156108b8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016108af9061545a565b60405180910390fd5b60006108c2611c33565b90508073ffffffffffffffffffffffffffffffffffffffff1662f714ce84846040518363ffffffff167c010000000000000000000000000000000000000000000000000000000002815260040161091a929190615660565b600060405180830381600087803b15801561093457600080fd5b505af1158015610948573d6000803e3d6000fd5b50505050505050565b606760009054906101000a900464ffffffffff1681565b600061097e82606c611c4290919063ffffffff16565b9050919050565b60606109be7f736368656d61732e7075626c69632e7461626c65730000000000000000000000600102606c611cb990919063ffffffff16565b905090565b60008060006109dc84606c611cd990919063ffffffff16565b600190049050807c0100000000000000000000000000000000000000000000000000000000029150602081908060020a8204915050925050915091565b610a216112ad565b1515610a62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a599061545a565b60405180910390fd5b60006001026068600086815260200190815260200160002054141515610abd576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610ab49061551a565b60405180910390fd5b6000809050610acd858583611cf9565b610b067f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010287606c611da59092919063ffffffff16565b50610b1b856069611ed090919063ffffffff16565b50610b2886868585610f3b565b50505050505050565b6000610b3b611c33565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610b8f9190615191565b60206040518083038186803b158015610ba757600080fd5b505afa158015610bbb573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250610bdf91908101906147e8565b905090565b84600080610bf183611797565b91509150600082111515610c3a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610c319061533a565b60405180910390fd5b6001821180610c54575060011515610c506112ad565b1515145b80610c915750610c62611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515610cd2576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610cc99061541a565b60405180910390fd5b6000610cde888a611f44565b90506000610cec8883611f44565b905060001515610d0682606c611c4290919063ffffffff16565b1515141515610d4a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610d419061549a565b60405180910390fd5b610d52611fa1565b610d688a886069611fe49092919063ffffffff16565b5060001515610d8183606c611c4290919063ffffffff16565b15151415610d9557610d9482888c61202f565b5b610dab8187606c6120df9092919063ffffffff16565b5050505050505050505050565b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010281565b6000610df582606c611c4290919063ffffffff16565b15610e1557610e0e82606c611cd990919063ffffffff16565b9050610e1d565b600060010290505b919050565b610e2a6112ad565b1515610e6b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610e629061545a565b60405180910390fd5b600073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a36000603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550565b6000610f3661220a565b905090565b6000610f456112ad565b1515610f86576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610f7d9061545a565b60405180910390fd5b610f8e613f54565b610f9986858561223b565b90506060610fa6826122b8565b9050610fbe8682606c6120df9092919063ffffffff16565b92505050949350505050565b6000610fd68587611f44565b90506000610fe48583611f44565b9050610ff287878487612388565b610ffa611fa1565b6110108184606c6125e39092919063ffffffff16565b508285887f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718761103e611ef0565b60405161104c92919061522d565b60405180910390a450505050505050565b6000611067610f2c565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156110d6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016110cd906152ba565b60405180910390fd5b61112383838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505061270e565b905092915050565b60006111378385611f44565b905061114584828585612715565b61114d611fa1565b611163848360696129699092919063ffffffff16565b5050505050565b600060606000611178610859565b9050600060666000838152602001908152602001600020549050606760009054906101000a900464ffffffffff1664ffffffffff16811015156111ca576111bf600b6129b4565b9350935050506111d9565b6111d26129d6565b9350935050505b9b509b9950505050505050505050565b60006111f58486611f44565b905060006112038483611f44565b905061121186838786612715565b611219611fa1565b600061122f82606c6129fb90919063ffffffff16565b90506001151581151514151561127a576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016112719061543a565b60405180910390fd5b50505050505050565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16905090565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166112f0611ef0565b73ffffffffffffffffffffffffffffffffffffffff1614905090565b611314613f54565b606061132a83606c612a7290919063ffffffff16565b905061133581612a92565b915050919050565b60666020528060005260406000206000915090505481565b60606040805190810160405280600581526020017f312e302e30000000000000000000000000000000000000000000000000000000815250905090565b8460008061139f83611797565b915091506000821115156113e8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016113df9061533a565b60405180910390fd5b60018211806114025750600115156113fe6112ad565b1515145b8061143f5750611410611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515611480576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016114779061541a565b60405180910390fd5b600061148c888a611f44565b9050600061149a8883611f44565b9050600015156114b482606c611c4290919063ffffffff16565b15151415156114f8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016114ef9061549a565b60405180910390fd5b611500611fa1565b6115168a886069611fe49092919063ffffffff16565b506000151561152f83606c611c4290919063ffffffff16565b151514156115435761154282888c61202f565b5b6115598187606c6125e39092919063ffffffff16565b5085888b7f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718a611587611ef0565b60405161159592919061522d565b60405180910390a450505050505050505050565b6115b16112ad565b15156115f2576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115e99061545a565b60405180910390fd5b80606760006101000a81548164ffffffffff021916908364ffffffffff16021790555050565b606060011515611632836069612b3b90919063ffffffff16565b1515141515611676576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161166d9061555a565b60405180910390fd5b61168a826069612b5b90919063ffffffff16565b9050919050565b600060019054906101000a900460ff16806116b057506116af612bca565b5b806116c757506000809054906101000a900460ff16155b1515611708576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016116ff9061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015611758576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b61176133612be1565b61176a82612d8b565b611772612e80565b80156117935760008060016101000a81548160ff0219169083151502179055505b5050565b600080600060010260686000858152602001908152602001600020541115156117f5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016117ec906155ba565b60405180910390fd5b600060686000858152602001908152602001600020546001900490508060ff169250600881908060020a8204915050915050915091565b611834610f2c565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156118a3576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161189a906152ba565b60405180910390fd5b6118f385858080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050848484612ee2565b5050505050565b606061191082606c611c4290919063ffffffff16565b156119305761192982606c612a7290919063ffffffff16565b9050611968565b60006040519080825280601f01601f1916602001820160405280156119645781602001600182028038833980820191505090505b5090505b919050565b6119756112ad565b15156119b6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016119ad9061545a565b60405180910390fd5b60006001026068600083815260200190815260200160002081905550611a0b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010283606c612ee89092919063ffffffff16565b50611a20816069612f0b90919063ffffffff16565b505050565b6000611a3d83836069612f449092919063ffffffff16565b905092915050565b611a4d6112ad565b1515611a8e576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611a859061545a565b60405180910390fd5b611a9781612f8f565b50565b6000611aa46112ad565b1515611ae5576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611adc9061545a565b60405180910390fd5b6000611aef611c33565b90506000611afb611c33565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611b4f9190615191565b60206040518083038186803b158015611b6757600080fd5b505afa158015611b7b573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611b9f91908101906147e8565b90508173ffffffffffffffffffffffffffffffffffffffff1662f714ce82866040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611bf7929190615660565b600060405180830381600087803b158015611c1157600080fd5b505af1158015611c25573d6000803e3d6000fd5b505050508092505050919050565b6000611c3d61220a565b905090565b6000611c5a82846000016130c190919063ffffffff16565b80611c775750611c7682846003016130e190919063ffffffff16565b5b80611c945750611c938284600601612b3b90919063ffffffff16565b5b80611cb15750611cb0828460090161310190919063ffffffff16565b5b905092915050565b6060611cd18284600601612b5b90919063ffffffff16565b905092915050565b6000611cf1828460000161312190919063ffffffff16565b905092915050565b611d016112ad565b1515611d42576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611d399061545a565b60405180910390fd5b60008260ff168117905060088273ffffffffffffffffffffffffffffffffffffffff169060020a0273ffffffffffffffffffffffffffffffffffffffff168117905080600102606860008681526020019081526020016000208190555050505050565b6000611dbd83856000016130c190919063ffffffff16565b151515611dff576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611df69061539a565b60405180910390fd5b611e1583856003016130e190919063ffffffff16565b151515611e57576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611e4e9061539a565b60405180910390fd5b611e6d838560090161310190919063ffffffff16565b151515611eaf576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611ea69061539a565b60405180910390fd5b611ec7838386600601611fe49092919063ffffffff16565b90509392505050565b6000611ee8828460010161318c90919063ffffffff16565b905092915050565b6000611efa61220a565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16141515611f3657339050611f41565b611f3e6131f8565b90505b90565b60006060604080519080825280601f01601f191660200182016040528015611f7b5781602001600182028038833980820191505090505b509050836040820152826020820152600081805190602001209050809250505092915050565b6000611fab610859565b90506000606660008381526020019081526020016000205490506001810160666000848152602001908152602001600020819055505050565b6000611ff08484612b3b565b156120235761201c8285600001600086815260200190815260200160002061318c90919063ffffffff16565b9050612028565b600090505b9392505050565b6000151561204784606c611c4290919063ffffffff16565b151514151561208b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612082906153ba565b60405180910390fd5b60004263ffffffff16905060206120a0611ef0565b73ffffffffffffffffffffffffffffffffffffffff169060020a02811790506120d88482600102606c6125e39092919063ffffffff16565b5050505050565b60006120f783856000016130c190919063ffffffff16565b151515612139576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121309061539a565b60405180910390fd5b61214f8385600601612b3b90919063ffffffff16565b151515612191576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121889061539a565b60405180910390fd5b6121a7838560090161310190919063ffffffff16565b1515156121e9576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121e09061539a565b60405180910390fd5b6122018383866003016132709092919063ffffffff16565b90509392505050565b6000807f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050805491505090565b612243613f54565b81518351141515612289576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612280906153da565b60405180910390fd5b612291613f54565b848160000181815250506122a584846132bb565b8160200181905250809150509392505050565b606060006122c5836133d1565b90506060816040519080825280601f01601f1916602001820160405280156122fc5781602001600182028038833980820191505090505b509050612318828286600001516133ec9092919063ffffffff16565b602082039150612337828286602001516133f69092919063ffffffff16565b915060008214151561237e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016123759061529a565b60405180910390fd5b8092505050919050565b600115156123a285836069612f449092919063ffffffff16565b15151415156123e6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016123dd9061559a565b60405180910390fd5b6000806123f286611797565b9150915060008211151561243b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612432906152fa565b60405180910390fd5b60018211806124555750600115156124516112ad565b1515145b806124925750612463611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15156124d3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016124ca9061537a565b60405180910390fd5b6002821015156125db5760006124f385606c611cd990919063ffffffff16565b9050600060208260019004908060020a82049150509050612512611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16141561254a576125d8565b600115156125566112ad565b151514806125965750612567611ef0565b73ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16145b15156125d7576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016125ce906153fa565b60405180910390fd5b5b50505b505050505050565b60006125fb83856003016130e190919063ffffffff16565b15151561263d576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016126349061539a565b60405180910390fd5b6126538385600601612b3b90919063ffffffff16565b151515612695576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161268c9061539a565b60405180910390fd5b6126ab838560090161310190919063ffffffff16565b1515156126ed576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016126e49061539a565b60405180910390fd5b6127058383866000016134b39092919063ffffffff16565b90509392505050565b6000919050565b6001151561272f85836069612f449092919063ffffffff16565b1515141515612773576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161276a9061553a565b60405180910390fd5b60008061277f86611797565b915091506000821115156127c8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016127bf906152da565b60405180910390fd5b60018211806127e25750600115156127de6112ad565b1515145b8061281f57506127f0611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612860576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612857906154ba565b60405180910390fd5b600282101515612961576128726112ad565b806128af5750612880611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b156128b957612960565b60006128cf86606c611cd990919063ffffffff16565b9050600060208260019004908060020a820491505090506128ee611ef0565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151561295d576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612954906155da565b60405180910390fd5b50505b5b505050505050565b60006129758484612b3b565b156129a8576129a1828560000160008681526020019081526020016000206134ee90919063ffffffff16565b90506129ad565b600090505b9392505050565b6000606082600b01602060405190810160405280600081525091509150915091565b600060606129f360206040519081016040528060008152506135e7565b915091509091565b6000612a1382846000016135f790919063ffffffff16565b80612a305750612a2f828460030161364990919063ffffffff16565b5b80612a4d5750612a4c8284600601612f0b90919063ffffffff16565b5b80612a6a5750612a6982846009016136a390919063ffffffff16565b5b905092915050565b6060612a8a82846003016136dc90919063ffffffff16565b905092915050565b612a9a613f54565b600082519050612aa8613f54565b612abb82856137df90919063ffffffff16565b816000018181525050602082039150612add82856137ed90919063ffffffff16565b819150826020018194508290525050600082141515612b31576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612b289061529a565b60405180910390fd5b8092505050919050565b6000612b5382846001016138f890919063ffffffff16565b905092915050565b6060612b678383612b3b565b15612b9057612b8983600001600084815260200190815260200160002061391b565b9050612bc4565b6000604051908082528060200260200182016040528015612bc05781602001602082028038833980820191505090505b5090505b92915050565b6000803090506000813b9050600081149250505090565b600060019054906101000a900460ff1680612c005750612bff612bca565b5b80612c1757506000809054906101000a900460ff16155b1515612c58576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c4f9061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015612ca8576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16600073ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a38015612d875760008060016101000a81548160ff0219169083151502179055505b5050565b600060019054906101000a900460ff1680612daa5750612da9612bca565b5b80612dc157506000809054906101000a900460ff16155b1515612e02576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612df99061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015612e52576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b612e5b826139b8565b8015612e7c5760008060016101000a81548160ff0219169083151502179055505b5050565b6103e8606760006101000a81548164ffffffffff021916908364ffffffffff160217905550612edf7f736368656d61732e7075626c69632e7461626c657300000000000000000000006001026000606c613aad9092919063ffffffff16565b50565b50505050565b6000612f028383866006016129699092919063ffffffff16565b90509392505050565b6000612f178383612b3b565b15612f3957612f3282846001016134ee90919063ffffffff16565b9050612f3e565b600090505b92915050565b6000612f508484612b3b565b15612f8357612f7c828560000160008681526020019081526020016000206138f890919063ffffffff16565b9050612f88565b600090505b9392505050565b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151515613001576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ff89061531a565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a380603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b60006130d982846001016138f890919063ffffffff16565b905092915050565b60006130f982846001016138f890919063ffffffff16565b905092915050565b600061311982846001016138f890919063ffffffff16565b905092915050565b600061312d83836130c1565b151561316e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016131659061557a565b60405180910390fd5b82600001600083815260200190815260200160002054905092915050565b600061319883836138f8565b15156131ed5782600101829080600181540180825580915050906001820390600052602060002001600090919290919091505583600001600084815260200190815260200160002081905550600190506131f2565b600090505b92915050565b600060606000368080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509050600080369050905073ffffffffffffffffffffffffffffffffffffffff81830151169250829250505090565b600081846000016000858152602001908152602001600020908051906020019061329b929190613f71565b506132b2838560010161318c90919063ffffffff16565b90509392505050565b606081518351141515613303576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016132fa906153da565b60405180910390fd5b6060835160405190808252806020026020018201604052801561334057816020015b61332d613ff1565b8152602001906001900390816133255790505b50905060008090505b84518110156133c65761335a614011565b858281518110151561336857fe5b90602001906020020151816000018181525050848281518110151561338957fe5b906020019060200201518160200181815250508083838151811015156133ab57fe5b90602001906020020181905250508080600101915050613349565b508091505092915050565b60006133e08260200151613d95565b60208001019050919050565b8282820152505050565b600080839050613419818461340a88613d95565b613da39092919063ffffffff16565b60208103905060008090505b85518110156134a75761345e8285888481518110151561344157fe5b90602001906020020151600001516133ec9092919063ffffffff16565b6020820391506134948285888481518110151561347757fe5b90602001906020020151602001516133ec9092919063ffffffff16565b6020820391508080600101915050613425565b50809150509392505050565b600081846000016000858152602001908152602001600020819055506134e5838560010161318c90919063ffffffff16565b90509392505050565b60006134fa83836138f8565b156135dc5760006001846000016000858152602001908152602001600020540390506000600185600101805490500390508181141515613593576000856001018281548110151561354757fe5b9060005260206000200154905080866001018481548110151561356657fe5b90600052602060002001819055506001830186600001600083815260200190815260200160002081905550505b846000016000858152602001908152602001600020600090558460010180548015156135bb57fe5b600190038181906000526020600020016000905590556001925050506135e1565b600090505b92915050565b6000606060008391509150915091565b600061360383836130c1565b1561363e578260000160008381526020019081526020016000206000905561363782846001016134ee90919063ffffffff16565b9050613643565b600090505b92915050565b600061365583836130e1565b1561369857826000016000838152602001908152602001600020600061367b9190614031565b61369182846001016134ee90919063ffffffff16565b905061369d565b600090505b92915050565b60006136af8383613101565b156136d1576136ca82846001016134ee90919063ffffffff16565b90506136d6565b600090505b92915050565b60606136e883836130e1565b1515613729576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016137209061557a565b60405180910390fd5b8260000160008381526020019081526020016000208054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156137d25780601f106137a7576101008083540402835291602001916137d2565b820191906000526020600020905b8154815290600101906020018083116137b557829003601f168201915b5050505050905092915050565b600081830151905092915050565b6060600080839050600061380a8287613dad90919063ffffffff16565b9050602082039150600060408281151561382057fe5b04905060608160405190808252806020026020018201604052801561385f57816020015b61384c613ff1565b8152602001906001900390816138445790505b50905060008090505b828110156138e657613878614011565b61388b868b6137df90919063ffffffff16565b8160000181815250506020860395506138ad868b6137df90919063ffffffff16565b8160200181815250506020860395508083838151811015156138cb57fe5b90602001906020020181905250508080600101915050613868565b50808495509550505050509250929050565b600080836000016000848152602001908152602001600020541415905092915050565b60608082600101805490506040519080825280602002602001820160405280156139545781602001602082028038833980820191505090505b50905060005b83600101805490508110156139ae57836001018181548110151561397a57fe5b9060005260206000200154828281518110151561399357fe5b9060200190602002018181525050808060010191505061395a565b5080915050919050565b600060019054906101000a900460ff16806139d757506139d6612bca565b5b806139ee57506000809054906101000a900460ff16155b1515613a2f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a269061547a565b60405180910390fd5b60008060019054906101000a900460ff161590508015613a7f576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b613a8882613dbb565b8015613aa95760008060016101000a81548160ff0219169083151502179055505b5050565b60006004826003811115613abd57fe5b60ff16101515613b02576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613af9906154fa565b60405180910390fd5b613b1883856000016130c190919063ffffffff16565b151515613b5a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613b519061539a565b60405180910390fd5b613b7083856003016130e190919063ffffffff16565b151515613bb2576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ba99061539a565b60405180910390fd5b613bc88385600601612b3b90919063ffffffff16565b151515613c0a576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c019061539a565b60405180910390fd5b613c20838560090161310190919063ffffffff16565b151515613c62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c599061539a565b60405180910390fd5b816003811115613c6e57fe5b60006003811115613c7b57fe5b1415613c9e57613c978385600601611ed090919063ffffffff16565b9050613d8e565b816003811115613caa57fe5b60016003811115613cb757fe5b1415613cda57613cd38385600901613f3490919063ffffffff16565b9050613d8e565b816003811115613ce657fe5b60026003811115613cf357fe5b1415613d1c57613d15836000600102866000016134b39092919063ffffffff16565b9050613d8e565b816003811115613d2857fe5b600380811115613d3457fe5b1415613d8d57613d868360006040519080825280601f01601f191660200182016040528015613d725781602001600182028038833980820191505090505b50866003016132709092919063ffffffff16565b9050613d8e565b5b9392505050565b600060408251029050919050565b8282820152505050565b600081830151905092915050565b6000613dc561220a565b9050600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515613e39576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613e30906154da565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515613eaa576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ea19061535a565b60405180910390fd5b8173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167fb9f84b8e65164b14439ae3620df0a4d8786d896996c0282b683f9d8c08f046e860405160405180910390a360007f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050828155505050565b6000613f4c828460010161318c90919063ffffffff16565b905092915050565b604080519081016040528060008019168152602001606081525090565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10613fb257805160ff1916838001178555613fe0565b82800160010185558215613fe0579182015b82811115613fdf578251825591602001919060010190613fc4565b5b509050613fed9190614079565b5090565b604080519081016040528060008019168152602001600080191681525090565b604080519081016040528060008019168152602001600080191681525090565b50805460018160011615610100020316600290046000825580601f106140575750614076565b601f0160209004906000526020600020908101906140759190614079565b5b50565b61409b91905b8082111561409757600081600090555060010161407f565b5090565b90565b60006140aa8235615856565b905092915050565b60006140be8235615868565b905092915050565b600082601f83011215156140d957600080fd5b81356140ec6140e782615701565b6156d4565b9150818183526020840193506020810190508385602084028201111561411157600080fd5b60005b838110156141415781614127888261415f565b845260208401935060208301925050600181019050614114565b5050505092915050565b6000614157823561587a565b905092915050565b600061416b8235615886565b905092915050565b60008083601f840112151561418757600080fd5b8235905067ffffffffffffffff8111156141a057600080fd5b6020830191508360018202830111156141b857600080fd5b9250929050565b600082601f83011215156141d257600080fd5b81356141e56141e082615729565b6156d4565b9150808252602083016020830185838301111561420157600080fd5b61420c8382846158dd565b50505092915050565b60006142218235615890565b905092915050565b60006142358251615890565b905092915050565b6000614249823561589a565b905092915050565b60006020828403121561426357600080fd5b60006142718482850161409e565b91505092915050565b60006020828403121561428c57600080fd5b600061429a848285016140b2565b91505092915050565b60008060008060008060008060008060006101208c8e0312156142c557600080fd5b60006142d38e828f0161409e565b9b505060206142e48e828f0161409e565b9a505060408c013567ffffffffffffffff81111561430157600080fd5b61430d8e828f01614173565b995099505060606143208e828f01614215565b97505060806143318e828f01614215565b96505060a06143428e828f01614215565b95505060c06143538e828f01614215565b94505060e08c013567ffffffffffffffff81111561437057600080fd5b61437c8e828f01614173565b93509350506101006143908e828f01614215565b9150509295989b509295989b9093969950565b6000602082840312156143b557600080fd5b60006143c38482850161415f565b91505092915050565b600080604083850312156143df57600080fd5b60006143ed8582860161415f565b92505060206143fe8582860161415f565b9150509250929050565b6000806000806080858703121561441e57600080fd5b600061442c8782880161415f565b945050602061443d8782880161415f565b935050604085013567ffffffffffffffff81111561445a57600080fd5b614466878288016140c6565b925050606085013567ffffffffffffffff81111561448357600080fd5b61448f878288016140c6565b91505092959194509250565b6000806000606084860312156144b057600080fd5b60006144be8682870161415f565b93505060206144cf8682870161415f565b92505060406144e08682870161415f565b9150509250925092565b6000806000806080858703121561450057600080fd5b600061450e8782880161415f565b945050602061451f8782880161415f565b93505060406145308782880161415f565b92505060606145418782880161415f565b91505092959194509250565b600080600080600060a0868803121561456557600080fd5b60006145738882890161415f565b95505060206145848882890161415f565b94505060406145958882890161415f565b93505060606145a68882890161415f565b92505060806145b78882890161415f565b9150509295509295909350565b600080600080600060a086880312156145dc57600080fd5b60006145ea8882890161415f565b95505060206145fb8882890161415f565b945050604061460c8882890161415f565b935050606061461d8882890161415f565b925050608086013567ffffffffffffffff81111561463a57600080fd5b614646888289016141bf565b9150509295509295909350565b600080600080600060a0868803121561466b57600080fd5b60006146798882890161415f565b955050602061468a8882890161415f565b945050604061469b8882890161423d565b935050606086013567ffffffffffffffff8111156146b857600080fd5b6146c4888289016140c6565b925050608086013567ffffffffffffffff8111156146e157600080fd5b6146ed888289016140c6565b9150509295509295909350565b6000806020838503121561470d57600080fd5b600083013567ffffffffffffffff81111561472757600080fd5b61473385828601614173565b92509250509250929050565b60008060008060006080868803121561475757600080fd5b600086013567ffffffffffffffff81111561477157600080fd5b61477d88828901614173565b955095505060206147908882890161414b565b93505060406147a188828901614215565b92505060606147b28882890161415f565b9150509295509295909350565b6000602082840312156147d157600080fd5b60006147df84828501614215565b91505092915050565b6000602082840312156147fa57600080fd5b600061480884828501614229565b91505092915050565b6000806040838503121561482457600080fd5b600061483285828601614215565b9250506020614843858286016140b2565b9150509250929050565b614856816158a7565b82525050565b614865816157c7565b82525050565b614874816157b5565b82525050565b60006148858261576f565b80845260208401935061489783615755565b60005b828110156148c9576148ad86835161493f565b6148b68261579b565b915060208601955060018101905061489a565b50849250505092915050565b60006148e08261577a565b8084526020840193506148f283615762565b60005b82811015614924576149088683516150ec565b614911826157a8565b91506040860195506001810190506148f5565b50849250505092915050565b614939816157d9565b82525050565b614948816157e5565b82525050565b614957816157ef565b82525050565b600061496882615785565b80845261497c8160208601602086016158ec565b6149858161591f565b602085010191505092915050565b600061499e82615790565b8084526149b28160208601602086016158ec565b6149bb8161591f565b602085010191505092915050565b6000601c82527f456e636f64696e67204572726f723a206f666673657420213d20302e000000006020830152604082019050919050565b6000602682527f47534e426f756e636572426173653a2063616c6c6572206973206e6f7420526560208301527f6c617948756200000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65006020830152604082019050919050565b6000601a82527f43616e6e6f74205550444154452073797374656d207461626c650000000000006020830152604082019050919050565b6000602682527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160208301527f64647265737300000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65006020830152604082019050919050565b6000602b82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f63757272656e74206f6e650000000000000000000000000000000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20555044415445206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602082527f4572726f723a206b65792065786973747320696e206f7468657220646963742e6020830152604082019050919050565b6000601582527f726f7720616c726561647920686173206f776e657200000000000000000000006020830152604082019050919050565b6000601082527f4572726f7220616c69676e6d656e742e000000000000000000000000000000006020830152604082019050919050565b6000603982527f4e6f7420726f774f776e6572206f72206f776e65722f64656c6567617465206660208301527f6f722055504441544520696e746f2074686973207461626c65000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20494e53455254206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000601282527f6572726f722072656d6f76696e67206b657900000000000000000000000000006020830152604082019050919050565b6000602082527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726020830152604082019050919050565b6000602e82527f436f6e747261637420696e7374616e63652068617320616c726561647920626560208301527f656e20696e697469616c697a65640000000000000000000000000000000000006040830152606082019050919050565b6000601782527f69642b6669656c6420616c7265616479206578697374730000000000000000006020830152604082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e2044454c455445206660208301527f726f6d2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602c82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f7a65726f206164647265737300000000000000000000000000000000000000006040830152606082019050919050565b6000601382527f496e76616c6964207461626c65207479706521000000000000000000000000006020830152604082019050919050565b6000601482527f5461626c6520616c7265616479206578697374730000000000000000000000006020830152604082019050919050565b6000601082527f696420646f65736e2774206578697374000000000000000000000000000000006020830152604082019050919050565b6000601182527f7461626c65206e6f7420637265617465640000000000000000000000000000006020830152604082019050919050565b6000601382527f4b657920646f6573206e6f7420657869737421000000000000000000000000006020830152604082019050919050565b6000601c82527f696420646f65736e27742065786973742c2075736520494e53455254000000006020830152604082019050919050565b6000601482527f7461626c6520646f6573206e6f742065786973740000000000000000000000006020830152604082019050919050565b6000601782527f53656e646572206e6f74206f776e6572206f6620726f770000000000000000006020830152604082019050919050565b604082016000820151615102600085018261493f565b506020820151615115602085018261493f565b50505050565b6000604083016000830151615133600086018261493f565b506020830151848203602086015261514b82826148d5565b9150508091505092915050565b6151618161583b565b82525050565b61517081615845565b82525050565b600060208201905061518b600083018461486b565b92915050565b60006020820190506151a6600083018461484d565b92915050565b60006040820190506151c1600083018561486b565b6151ce602083018461494e565b9392505050565b600060208201905081810360008301526151ef818461487a565b905092915050565b600060208201905061520c6000830184614930565b92915050565b6000602082019050615227600083018461493f565b92915050565b6000604082019050615242600083018561493f565b61524f602083018461486b565b9392505050565b60006020820190508181036000830152615270818461495d565b905092915050565b600060208201905081810360008301526152928184614993565b905092915050565b600060208201905081810360008301526152b3816149c9565b9050919050565b600060208201905081810360008301526152d381614a00565b9050919050565b600060208201905081810360008301526152f381614a5d565b9050919050565b6000602082019050818103600083015261531381614a94565b9050919050565b6000602082019050818103600083015261533381614acb565b9050919050565b6000602082019050818103600083015261535381614b28565b9050919050565b6000602082019050818103600083015261537381614b5f565b9050919050565b6000602082019050818103600083015261539381614bbc565b9050919050565b600060208201905081810360008301526153b381614c19565b9050919050565b600060208201905081810360008301526153d381614c50565b9050919050565b600060208201905081810360008301526153f381614c87565b9050919050565b6000602082019050818103600083015261541381614cbe565b9050919050565b6000602082019050818103600083015261543381614d1b565b9050919050565b6000602082019050818103600083015261545381614d78565b9050919050565b6000602082019050818103600083015261547381614daf565b9050919050565b6000602082019050818103600083015261549381614de6565b9050919050565b600060208201905081810360008301526154b381614e43565b9050919050565b600060208201905081810360008301526154d381614e7a565b9050919050565b600060208201905081810360008301526154f381614ed7565b9050919050565b6000602082019050818103600083015261551381614f34565b9050919050565b6000602082019050818103600083015261553381614f6b565b9050919050565b6000602082019050818103600083015261555381614fa2565b9050919050565b6000602082019050818103600083015261557381614fd9565b9050919050565b6000602082019050818103600083015261559381615010565b9050919050565b600060208201905081810360008301526155b381615047565b9050919050565b600060208201905081810360008301526155d38161507e565b9050919050565b600060208201905081810360008301526155f3816150b5565b9050919050565b60006020820190508181036000830152615614818461511b565b905092915050565b60006020820190506156316000830184615158565b92915050565b600060408201905061564c6000830185615158565b615659602083018461486b565b9392505050565b60006040820190506156756000830185615158565b615682602083018461485c565b9392505050565b600060408201905061569e6000830185615158565b81810360208301526156b0818461495d565b90509392505050565b60006020820190506156ce6000830184615167565b92915050565b6000604051905081810181811067ffffffffffffffff821117156156f757600080fd5b8060405250919050565b600067ffffffffffffffff82111561571857600080fd5b602082029050602081019050919050565b600067ffffffffffffffff82111561574057600080fd5b601f19601f8301169050602081019050919050565b6000602082019050919050565b6000602082019050919050565b600081519050919050565b600081519050919050565b600081519050919050565b600081519050919050565b6000602082019050919050565b6000602082019050919050565b60006157c08261581b565b9050919050565b60006157d28261581b565b9050919050565b60008115159050919050565b6000819050919050565b60007fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000819050919050565b600064ffffffffff82169050919050565b60006158618261581b565b9050919050565b60006158738261581b565b9050919050565b60008115159050919050565b6000819050919050565b6000819050919050565b600060ff82169050919050565b60006158b2826158b9565b9050919050565b60006158c4826158cb565b9050919050565b60006158d68261581b565b9050919050565b82818337600083830152505050565b60005b8381101561590a5780820151818401526020810190506158ef565b83811115615919576000848401525b50505050565b6000601f19601f830116905091905056fea265627a7a723058204adf0a4d4d7fd656a78155f129f8697c6a17c9ce00b2b0657209b16fb78e194d6c6578706572696d656e74616cf50037";
var compiler = {
	name: "solc",
	version: "0.5.0+commit.1d4f565a.Emscripten.clang",
	optimizer: {
		enabled: false,
		runs: 200
	},
	evmVersion: "byzantium"
};
var networks = {
	"3": {
		links: {
		},
		events: {
		},
		address: "0x29408db953eC74A4468e438c7b5607dCB056F454",
		updated_at: 1588234893940
	},
	"1587523878365": {
		links: {
		},
		events: {
		},
		address: "0xe982E462b094850F12AF94d21D470e21bE9D0E9C",
		updated_at: 1587525232869
	},
	"1587621605460": {
		links: {
		},
		events: {
		},
		address: "0x630589690929E9cdEFDeF0734717a9eF3Ec7Fcfe",
		updated_at: 1587622068052
	},
	"1587687261530": {
		links: {
		},
		events: {
		},
		address: "0xD44d92D878Bb19649bE73702E514560743B3CF86",
		updated_at: 1587696551227
	},
	"1587696563997": {
		links: {
		},
		events: {
		},
		address: "0xb113d904f84950c7b1C8663fAB9baa1d8095b1e2",
		updated_at: 1587699651042
	},
	"1587785460865": {
		links: {
		},
		events: {
		},
		address: "0x757dbc31BB286832d21C505F1D80FbcfF6756e49",
		updated_at: 1587793467869
	},
	"1587803664569": {
		links: {
		},
		events: {
		},
		address: "0xbF5b1e4C21Fb2fd9075cAE924f4C4Fa9BC9fa486",
		updated_at: 1587805680464
	},
	"1588058767189": {
		links: {
		},
		events: {
		},
		address: "0xeB028ecD162aAEccEe0632c3bb170a723C9712e2",
		updated_at: 1588060922869
	},
	"1588061032927": {
		links: {
		},
		events: {
		},
		address: "0xC89Ce4735882C9F0f0FE26686c53074E09B0D550",
		updated_at: 1588061065230
	},
	"1588061377501": {
		links: {
		},
		events: {
		},
		address: "0xDd37b2eB92F97dd09cEd1f1d20A73aA340b2311A",
		updated_at: 1588064911409
	},
	"1588065379253": {
		links: {
		},
		events: {
		},
		address: "0xB0015714B541A99265f529c7c0d34DA47deCA5b2",
		updated_at: 1588065395021
	},
	"1588066097663": {
		links: {
		},
		events: {
		},
		address: "0x352ebD84619597F4ec3d18Bea793143eAa2f4c46",
		updated_at: 1588071461252
	},
	"1588219419056": {
		links: {
		},
		events: {
		},
		address: "0x82b79c961EE10faAdAaFC0b9bD74d6EE8048032E",
		updated_at: 1588228289305
	},
	"1588229493030": {
		links: {
		},
		events: {
		},
		address: "0x43C4C56D45BA67CC04b5E13FAef8ba9317547C83",
		updated_at: 1588234601628
	}
};
var ELAJSStoreJSON = {
	fileName: fileName,
	contractName: contractName,
	source: source,
	sourcePath: sourcePath,
	sourceMap: sourceMap,
	deployedSourceMap: deployedSourceMap,
	abi: abi,
	ast: ast,
	bytecode: bytecode,
	deployedBytecode: deployedBytecode,
	compiler: compiler,
	networks: networks
};

var constants = {
  NETWORK: {
    LOCAL: 'LOCAL',
    TESTNET: 'TESTNET',
    MAINNET: 'MAINNET'
  },
  SIGNER: {
    EPHEMERAL: 'EPHEMERAL',
    FORTMATIC: 'FORTMATIC'
  },
  FIELD_TYPE: {
    BYTES32: 'BYTES32',
    STRING: 'STRING',
    BOOL: 'BOOL',
    UINT: 'UINT'
  }
};

var relayHubData = {
  abi: [{
    "constant": true,
    "inputs": [],
    "name": "version",
    "outputs": [{
      "name": "",
      "type": "string"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": false,
      "name": "stake",
      "type": "uint256"
    }, {
      "indexed": false,
      "name": "unstakeDelay",
      "type": "uint256"
    }],
    "name": "Staked",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": true,
      "name": "owner",
      "type": "address"
    }, {
      "indexed": false,
      "name": "transactionFee",
      "type": "uint256"
    }, {
      "indexed": false,
      "name": "stake",
      "type": "uint256"
    }, {
      "indexed": false,
      "name": "unstakeDelay",
      "type": "uint256"
    }, {
      "indexed": false,
      "name": "url",
      "type": "string"
    }],
    "name": "RelayAdded",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": false,
      "name": "unstakeTime",
      "type": "uint256"
    }],
    "name": "RelayRemoved",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": false,
      "name": "stake",
      "type": "uint256"
    }],
    "name": "Unstaked",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "recipient",
      "type": "address"
    }, {
      "indexed": true,
      "name": "from",
      "type": "address"
    }, {
      "indexed": false,
      "name": "amount",
      "type": "uint256"
    }],
    "name": "Deposited",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "account",
      "type": "address"
    }, {
      "indexed": true,
      "name": "dest",
      "type": "address"
    }, {
      "indexed": false,
      "name": "amount",
      "type": "uint256"
    }],
    "name": "Withdrawn",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": true,
      "name": "from",
      "type": "address"
    }, {
      "indexed": true,
      "name": "to",
      "type": "address"
    }, {
      "indexed": false,
      "name": "selector",
      "type": "bytes4"
    }, {
      "indexed": false,
      "name": "reason",
      "type": "uint256"
    }],
    "name": "CanRelayFailed",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": true,
      "name": "from",
      "type": "address"
    }, {
      "indexed": true,
      "name": "to",
      "type": "address"
    }, {
      "indexed": false,
      "name": "selector",
      "type": "bytes4"
    }, {
      "indexed": false,
      "name": "status",
      "type": "uint8"
    }, {
      "indexed": false,
      "name": "charge",
      "type": "uint256"
    }],
    "name": "TransactionRelayed",
    "type": "event"
  }, {
    "anonymous": false,
    "inputs": [{
      "indexed": true,
      "name": "relay",
      "type": "address"
    }, {
      "indexed": false,
      "name": "sender",
      "type": "address"
    }, {
      "indexed": false,
      "name": "amount",
      "type": "uint256"
    }],
    "name": "Penalized",
    "type": "event"
  }, {
    "constant": false,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }, {
      "name": "unstakeDelay",
      "type": "uint256"
    }],
    "name": "stake",
    "outputs": [],
    "payable": true,
    "stateMutability": "payable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "transactionFee",
      "type": "uint256"
    }, {
      "name": "url",
      "type": "string"
    }],
    "name": "registerRelay",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }],
    "name": "removeRelayByOwner",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }],
    "name": "unstake",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }],
    "name": "getRelay",
    "outputs": [{
      "name": "totalStake",
      "type": "uint256"
    }, {
      "name": "unstakeDelay",
      "type": "uint256"
    }, {
      "name": "unstakeTime",
      "type": "uint256"
    }, {
      "name": "owner",
      "type": "address"
    }, {
      "name": "state",
      "type": "uint8"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "target",
      "type": "address"
    }],
    "name": "depositFor",
    "outputs": [],
    "payable": true,
    "stateMutability": "payable",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "target",
      "type": "address"
    }],
    "name": "balanceOf",
    "outputs": [{
      "name": "",
      "type": "uint256"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "amount",
      "type": "uint256"
    }, {
      "name": "dest",
      "type": "address"
    }],
    "name": "withdraw",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "from",
      "type": "address"
    }],
    "name": "getNonce",
    "outputs": [{
      "name": "",
      "type": "uint256"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }],
    "name": "canUnstake",
    "outputs": [{
      "name": "",
      "type": "bool"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "relay",
      "type": "address"
    }, {
      "name": "from",
      "type": "address"
    }, {
      "name": "to",
      "type": "address"
    }, {
      "name": "encodedFunction",
      "type": "bytes"
    }, {
      "name": "transactionFee",
      "type": "uint256"
    }, {
      "name": "gasPrice",
      "type": "uint256"
    }, {
      "name": "gasLimit",
      "type": "uint256"
    }, {
      "name": "nonce",
      "type": "uint256"
    }, {
      "name": "signature",
      "type": "bytes"
    }, {
      "name": "approvalData",
      "type": "bytes"
    }],
    "name": "canRelay",
    "outputs": [{
      "name": "status",
      "type": "uint256"
    }, {
      "name": "recipientContext",
      "type": "bytes"
    }],
    "payable": true,
    "stateMutability": "payable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "from",
      "type": "address"
    }, {
      "name": "recipient",
      "type": "address"
    }, {
      "name": "encodedFunction",
      "type": "bytes"
    }, {
      "name": "transactionFee",
      "type": "uint256"
    }, {
      "name": "gasPrice",
      "type": "uint256"
    }, {
      "name": "gasLimit",
      "type": "uint256"
    }, {
      "name": "nonce",
      "type": "uint256"
    }, {
      "name": "signature",
      "type": "bytes"
    }, {
      "name": "approvalData",
      "type": "bytes"
    }],
    "name": "relayCall",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "recipient",
      "type": "address"
    }, {
      "name": "encodedFunctionWithFrom",
      "type": "bytes"
    }, {
      "name": "transactionFee",
      "type": "uint256"
    }, {
      "name": "gasPrice",
      "type": "uint256"
    }, {
      "name": "gasLimit",
      "type": "uint256"
    }, {
      "name": "preChecksGas",
      "type": "uint256"
    }, {
      "name": "recipientContext",
      "type": "bytes"
    }],
    "name": "recipientCallsAtomic",
    "outputs": [{
      "name": "",
      "type": "uint8"
    }],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "relayedCallStipend",
      "type": "uint256"
    }],
    "name": "requiredGas",
    "outputs": [{
      "name": "",
      "type": "uint256"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": true,
    "inputs": [{
      "name": "relayedCallStipend",
      "type": "uint256"
    }, {
      "name": "gasPrice",
      "type": "uint256"
    }, {
      "name": "transactionFee",
      "type": "uint256"
    }],
    "name": "maxPossibleCharge",
    "outputs": [{
      "name": "",
      "type": "uint256"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "unsignedTx1",
      "type": "bytes"
    }, {
      "name": "signature1",
      "type": "bytes"
    }, {
      "name": "unsignedTx2",
      "type": "bytes"
    }, {
      "name": "signature2",
      "type": "bytes"
    }],
    "name": "penalizeRepeatedNonce",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }, {
    "constant": false,
    "inputs": [{
      "name": "unsignedTx",
      "type": "bytes"
    }, {
      "name": "signature",
      "type": "bytes"
    }],
    "name": "penalizeIllegalTransaction",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }],
  // address: '0x2EDA8d1A61824dFa812C4bd139081B9BcB972A6D',
  // address: '0xD216153c06E857cD7f72665E0aF1d7D82172F494',
  bytecode: '0x60806040526040805190810160405280600581526020017f312e302e30000000000000000000000000000000000000000000000000000000815250600390805190602001906200005192919062000066565b503480156200005f57600080fd5b5062000115565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10620000a957805160ff1916838001178555620000da565b82800160010185558215620000da579182015b82811115620000d9578251825591602001919060010190620000bc565b5b509050620000e99190620000ed565b5090565b6200011291905b808211156200010e576000816000905550600101620000f4565b5090565b90565b615c7480620001256000396000f3fe6080604052600436106100fb576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168062f714ce146101005780631166073a1461015b5780632b6017471461022d5780632ca70eba1461051f5780632d0335ab1461066457806339002432146106c9578063405cec671461082857806354fd4d5014610a875780636a7d84a414610b1757806370a0823114610b6657806385f4498b14610bcb5780638d85146014610c34578063a863f8f914610cef578063a8cd957214610d52578063aa67c91914610fdf578063adc9772e14611023578063c3e712f214611071578063f2888dbb146110c2575b600080fd5b34801561010c57600080fd5b506101596004803603604081101561012357600080fd5b8101908080359060200190929190803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050611113565b005b34801561016757600080fd5b5061022b6004803603604081101561017e57600080fd5b8101908080359060200190929190803590602001906401000000008111156101a557600080fd5b8201836020820111156101b757600080fd5b803590602001918460018302840111640100000000831117156101d957600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505091929192905050506112cd565b005b61049d600480360361014081101561024457600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190803573ffffffffffffffffffffffffffffffffffffffff169060200190929190803573ffffffffffffffffffffffffffffffffffffffff169060200190929190803590602001906401000000008111156102c157600080fd5b8201836020820111156102d357600080fd5b803590602001918460018302840111640100000000831117156102f557600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290803590602001909291908035906020019092919080359060200190929190803590602001909291908035906020019064010000000081111561038057600080fd5b82018360208201111561039257600080fd5b803590602001918460018302840111640100000000831117156103b457600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505091929192908035906020019064010000000081111561041757600080fd5b82018360208201111561042957600080fd5b8035906020019184600183028401116401000000008311171561044b57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290505050611820565b6040518083815260200180602001828103825283818151815260200191508051906020019080838360005b838110156104e35780820151818401526020810190506104c8565b50505050905090810190601f1680156105105780820380516001836020036101000a031916815260200191505b50935050505060405180910390f35b34801561052b57600080fd5b50610640600480360360e081101561054257600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff1690602001909291908035906020019064010000000081111561057f57600080fd5b82018360208201111561059157600080fd5b803590602001918460018302840111640100000000831117156105b357600080fd5b909192939192939080359060200190929190803590602001909291908035906020019092919080359060200190929190803590602001906401000000008111156105fc57600080fd5b82018360208201111561060e57600080fd5b8035906020019184600183028401116401000000008311171561063057600080fd5b9091929391929390505050611f2e565b6040518082600481111561065057fe5b60ff16815260200191505060405180910390f35b34801561067057600080fd5b506106b36004803603602081101561068757600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050612523565b6040518082815260200191505060405180910390f35b3480156106d557600080fd5b50610826600480360360408110156106ec57600080fd5b810190808035906020019064010000000081111561070957600080fd5b82018360208201111561071b57600080fd5b8035906020019184600183028401116401000000008311171561073d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290803590602001906401000000008111156107a057600080fd5b8201836020820111156107b257600080fd5b803590602001918460018302840111640100000000831117156107d457600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050919291929050505061256b565b005b34801561083457600080fd5b50610a85600480360361012081101561084c57600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190803573ffffffffffffffffffffffffffffffffffffffff169060200190929190803590602001906401000000008111156108a957600080fd5b8201836020820111156108bb57600080fd5b803590602001918460018302840111640100000000831117156108dd57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290803590602001909291908035906020019092919080359060200190929190803590602001909291908035906020019064010000000081111561096857600080fd5b82018360208201111561097a57600080fd5b8035906020019184600183028401116401000000008311171561099c57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290803590602001906401000000008111156109ff57600080fd5b820183602082011115610a1157600080fd5b80359060200191846001830284011164010000000083111715610a3357600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505091929192905050506127a8565b005b348015610a9357600080fd5b50610a9c6131bf565b6040518080602001828103825283818151815260200191508051906020019080838360005b83811015610adc578082015181840152602081019050610ac1565b50505050905090810190601f168015610b095780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b348015610b2357600080fd5b50610b5060048036036020811015610b3a57600080fd5b810190808035906020019092919050505061325d565b6040518082815260200191505060405180910390f35b348015610b7257600080fd5b50610bb560048036036020811015610b8957600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff16906020019092919050505061327b565b6040518082815260200191505060405180910390f35b348015610bd757600080fd5b50610c1a60048036036020811015610bee57600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff1690602001909291905050506132c4565b604051808215151515815260200191505060405180910390f35b348015610c4057600080fd5b50610c8360048036036020811015610c5757600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050613360565b604051808681526020018581526020018481526020018373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001826003811115610cd757fe5b60ff1681526020019550505050505060405180910390f35b348015610cfb57600080fd5b50610d3c60048036036060811015610d1257600080fd5b810190808035906020019092919080359060200190929190803590602001909291905050506134f7565b6040518082815260200191505060405180910390f35b348015610d5e57600080fd5b50610fdd60048036036080811015610d7557600080fd5b8101908080359060200190640100000000811115610d9257600080fd5b820183602082011115610da457600080fd5b80359060200191846001830284011164010000000083111715610dc657600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050919291929080359060200190640100000000811115610e2957600080fd5b820183602082011115610e3b57600080fd5b80359060200191846001830284011164010000000083111715610e5d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050919291929080359060200190640100000000811115610ec057600080fd5b820183602082011115610ed257600080fd5b80359060200191846001830284011164010000000083111715610ef457600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050919291929080359060200190640100000000811115610f5757600080fd5b820183602082011115610f6957600080fd5b80359060200191846001830284011164010000000083111715610f8b57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290505050613515565b005b61102160048036036020811015610ff557600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff1690602001909291905050506139b4565b005b61106f6004803603604081101561103957600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff16906020019092919080359060200190929190505050613b2e565b005b34801561107d57600080fd5b506110c06004803603602081101561109457600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff16906020019092919050505061436d565b005b3480156110ce57600080fd5b50611111600480360360208110156110e557600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050614741565b005b600033905082600260008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054101515156111cf576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260128152602001807f696e73756666696369656e742066756e6473000000000000000000000000000081525060200191505060405180910390fd5b82600260008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055508173ffffffffffffffffffffffffffffffffffffffff166108fc849081150290604051600060405180830381858888f19350505050158015611262573d6000803e3d6000fd5b508173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167fd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb856040518082815260200191505060405180910390a3505050565b60003390503273ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151561139b576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260238152602001807f436f6e7472616374732063616e6e6f742072656769737465722061732072656c81526020017f617973000000000000000000000000000000000000000000000000000000000081525060400191505060405180910390fd5b600160038111156113a857fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff16600381111561140357fe5b148061147457506002600381111561141757fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff16600381111561147257fe5b145b15156114e8576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260158152602001807f77726f6e6720737461746520666f72207374616b65000000000000000000000081525060200191505060405180910390fd5b67016345785d8a00008173ffffffffffffffffffffffffffffffffffffffff16311015151561157f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252601a8152602001807f62616c616e6365206c6f776572207468616e206d696e696d756d00000000000081525060200191505060405180910390fd5b6002600381111561158c57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff1660038111156115e757fe5b141515611653576002600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160146101000a81548160ff0219169083600381111561164d57fe5b02179055505b600160008273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167f85b3ae3aae9d3fcb31142fbd8c3b4722d57825b8edd6e1366e69204afa5a0dfa85600160008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060000154600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060010154876040518085815260200184815260200183815260200180602001828103825283818151815260200191508051906020019080838360005b838110156117de5780820151818401526020810190506117c3565b50505050905090810190601f16801561180b5780820380516001836020036101000a031916815260200191505b509550505050505060405180910390a3505050565b60006060808b8b8b8b8b8b8b3060405160200180807f726c783a000000000000000000000000000000000000000000000000000000008152506004018973ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c010000000000000000000000000281526014018873ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c0100000000000000000000000002815260140187805190602001908083835b60208310151561190f57805182526020820191506020810190506020830392506118ea565b6001836020036101000a0380198251168184511680821785525050505050509050018681526020018581526020018481526020018381526020018273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c010000000000000000000000000281526014019850505050505050505060405160208183030381529060405290506000818e6040516020018083805190602001908083835b6020831015156119e157805182526020820191506020810190506020830392506119bc565b6001836020036101000a0380198251168184511680821785525050505050509050018273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c01000000000000000000000000028152601401925050506040516020818303038152906040528051906020012090508c73ffffffffffffffffffffffffffffffffffffffff16611a9287611a8484614a3e565b614a9690919063ffffffff16565b73ffffffffffffffffffffffffffffffffffffffff16141515611ad85760016004811115611abc57fe5b6020604051908101604052806000815250935093505050611f1f565b5050846000808d73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054141515611b485760026004811115611b2e57fe5b602060405190810160405280600081525091509150611f1f565b6000611b5587898b6134f7565b905060608b73ffffffffffffffffffffffffffffffffffffffff166383947ea090507c0100000000000000000000000000000000000000000000000000000000028e8e8d8d8d8d8d8c8a604051602401808a73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020018973ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001806020018881526020018781526020018681526020018581526020018060200184815260200183810383528a818151815260200191508051906020019080838360005b83811015611c68578082015181840152602081019050611c4d565b50505050905090810190601f168015611c955780820380516001836020036101000a031916815260200191505b50838103825285818151815260200191508051906020019080838360005b83811015611cce578082015181840152602081019050611cb3565b50505050905090810190601f168015611cfb5780820380516001836020036101000a031916815260200191505b509b505050505050505050505050604051602081830303815290604052907bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050509050600060608d73ffffffffffffffffffffffffffffffffffffffff1661c350846040518082805190602001908083835b602083101515611dbc5780518252602082019150602081019050602083039250611d97565b6001836020036101000a0380198251168184511680821785525050505050509050019150506000604051808303818686fa925050503d8060008114611e1d576040519150601f19603f3d011682016040523d82523d6000602084013e611e22565b606091505b5091509150811515611e595760036004811115611e3b57fe5b60206040519081016040528060008152509550955050505050611f1f565b808060200190516040811015611e6e57600080fd5b81019080805190602001909291908051640100000000811115611e9057600080fd5b82810190506020810184811115611ea657600080fd5b8151856001820283011164010000000082111715611ec357600080fd5b505092919050505080905080965081975050506000861480611ee55750600a86115b15611ef95785859550955050505050611f1f565b600480811115611f0557fe5b602060405190810160405280600081525095509550505050505b9a509a98505050505050505050565b6000611f38615b99565b5a8160000181815250503073ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151561200b576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260278152602001807f4f6e6c792052656c61794875622073686f756c642063616c6c2074686973206681526020017f756e6374696f6e0000000000000000000000000000000000000000000000000081525060400191505060405180910390fd5b600260008c73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205481602001818152505060608b73ffffffffffffffffffffffffffffffffffffffff166380274db790507c010000000000000000000000000000000000000000000000000000000002858560405160240180806020018281038252848482818152602001925080828437600081840152601f19601f8201169050808301925050509350505050604051602081830303815290604052907bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050509050600060608d73ffffffffffffffffffffffffffffffffffffffff16620186a0846040518082805190602001908083835b602083101515612184578051825260208201915060208101905060208303925061215f565b6001836020036101000a03801982511681845116808217855250505050505090500191505060006040518083038160008787f1925050503d80600081146121e7576040519150601f19603f3d011682016040523d82523d6000602084013e6121ec565b606091505b5091509150811515612203576122026002614b9d565b5b80806020019051602081101561221857600080fd5b81019080805190602001909291905050508460400181815250505050508a73ffffffffffffffffffffffffffffffffffffffff16868b8b60405180838380828437808301925050509250505060006040518083038160008787f1925050503d80600081146122a2576040519150601f19603f3d011682016040523d82523d6000602084013e6122a7565b606091505b505081606001811515151581525050606060006122d76122d05a85600001518a01036001614bd9565b8a8c614bfe565b90508c73ffffffffffffffffffffffffffffffffffffffff1663e06e0e2290507c010000000000000000000000000000000000000000000000000000000002868685606001518487604001516040516024018080602001851515151581526020018481526020018381526020018281038252878782818152602001925080828437600081840152601f19601f8201169050808301925050509650505050505050604051602081830303815290604052907bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff838183161783525050505091505060008c73ffffffffffffffffffffffffffffffffffffffff16620186a0836040518082805190602001908083835b60208310151561242a5780518252602082019150602081019050602083039250612405565b6001836020036101000a03801982511681845116808217855250505050505090500191505060006040518083038160008787f1925050503d806000811461248d576040519150601f19603f3d011682016040523d82523d6000602084013e612492565b606091505b505090508015156124a8576124a76003614b9d565b5b50508060200151600260008d73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020541015612500576124ff6004614b9d565b5b8060600151612510576001612513565b60005b9150509998505050505050505050565b60008060008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020549050919050565b612573615bc7565b61257c83614c1d565b90503073ffffffffffffffffffffffffffffffffffffffff16816060015173ffffffffffffffffffffffffffffffffffffffff16141561270f5760006125c58260a00151614c9a565b905063405cec677c0100000000000000000000000000000000000000000000000000000000027bffffffffffffffffffffffffffffffffffffffffffffffffffffffff1916817bffffffffffffffffffffffffffffffffffffffffffffffffffffffff1916141580156126995750631166073a7c0100000000000000000000000000000000000000000000000000000000027bffffffffffffffffffffffffffffffffffffffffffffffffffffffff1916817bffffffffffffffffffffffffffffffffffffffffffffffffffffffff191614155b151561270d576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260178152602001807f4c6567616c2072656c6179207472616e73616374696f6e00000000000000000081525060200191505060405180910390fd5b505b600061279783856040516020018082805190602001908083835b60208310151561274e5780518252602082019150602081019050602083039250612729565b6001836020036101000a03801982511681845116808217855250505050505090500191505060405160208183030381529060405280519060200120614a9690919063ffffffff16565b90506127a281614cb1565b50505050565b60005a9050600260038111156127ba57fe5b600160003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff16600381111561281557fe5b14151561288a576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600d8152602001807f556e6b6e6f776e2072656c61790000000000000000000000000000000000000081525060200191505060405180910390fd5b3a8611151515612902576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260118152602001807f496e76616c69642067617320707269636500000000000000000000000000000081525060200191505060405180910390fd5b61291661290e8661325d565b61bc4c615140565b811015151561298d576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260148152602001807f4e6f7420656e6f756768206761736c656674282900000000000000000000000081525060200191505060405180910390fd5b600260008a73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020546129d886888a6134f7565b11151515612a4e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260198152602001807f526563697069656e742062616c616e636520746f6f206c6f770000000000000081525060200191505060405180910390fd5b6000612a5b89600061518a565b905060606000612a73338e8e8e8e8e8e8e8e8e611820565b809350819250505060006004811115612a8857fe5b81141515612b5b578b73ffffffffffffffffffffffffffffffffffffffff168d73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167fafb5afd6d1c2e8ffbfb480e674a169f493ece0b22658d4f4484e7334f0241e22868560405180837bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19167bffffffffffffffffffffffffffffffffffffffffffffffffffffffff191681526020018281526020019250505060405180910390a4505050506131b4565b506000808d73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600081548092919060010191905055506000805a8503905060608c8f6040516020018083805190602001908083835b602083101515612bee5780518252602082019150602081019050602083039250612bc9565b6001836020036101000a0380198251168184511680821785525050505050509050018273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c010000000000000000000000000281526014019250505060405160208183030381529060405290506060632ca70eba7c0100000000000000000000000000000000000000000000000000000000028f838f8f8f888b604051602401808873ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020018060200187815260200186815260200185815260200184815260200180602001838103835289818151815260200191508051906020019080838360005b83811015612d24578082015181840152602081019050612d09565b50505050905090810190601f168015612d515780820380516001836020036101000a031916815260200191505b50838103825284818151815260200191508051906020019080838360005b83811015612d8a578082015181840152602081019050612d6f565b50505050905090810190601f168015612db75780820380516001836020036101000a031916815260200191505b509950505050505050505050604051602081830303815290604052907bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff8381831617835250505050905060603073ffffffffffffffffffffffffffffffffffffffff16826040518082805190602001908083835b602083101515612e715780518252602082019150602081019050602083039250612e4c565b6001836020036101000a0380198251168184511680821785525050505050509050019150506000604051808303816000865af19150503d8060008114612ed3576040519150601f19603f3d011682016040523d82523d6000602084013e612ed8565b606091505b50915050808060200190516020811015612ef157600080fd5b81019080805190602001909291905050509450505050506000612f21612f1a5a87036000614bd9565b8b8d614bfe565b905080600260008f73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205410151515612fda576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260138152602001807f53686f756c64206e6f742067657420686572650000000000000000000000000081525060200191505060405180910390fd5b80600260008f73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055508060026000600160003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055508c73ffffffffffffffffffffffffffffffffffffffff168e73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167fab74390d395916d9e0006298d47938a5def5d367054dcca78fa6ec84381f3f2287868660405180847bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19167bffffffffffffffffffffffffffffffffffffffffffffffffffffffff1916815260200183600481111561319357fe5b60ff168152602001828152602001935050505060405180910390a450505050505b505050505050505050565b60038054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156132555780601f1061322a57610100808354040283529160200191613255565b820191906000526020600020905b81548152906001019060200180831161323857829003601f168201915b505050505081565b600081620186a08061c350620186a061bc4c01010101019050919050565b6000600260008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020549050919050565b600080600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060020154118015613359575042600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206002015411155b9050919050565b6000806000806000600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600001549450600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600101549350600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600201549250600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff169150600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff16905091939590929450565b600061350c6135058561325d565b8484614bfe565b90509392505050565b600061359d84866040516020018082805190602001908083835b602083101515613554578051825260208201915060208101905060208303925061352f565b6001836020036101000a03801982511681845116808217855250505050505090500191505060405160208183030381529060405280519060200120614a9690919063ffffffff16565b9050600061362783856040516020018082805190602001908083835b6020831015156135de57805182526020820191506020810190506020830392506135b9565b6001836020036101000a03801982511681845116808217855250505050505090500191505060405160208183030381529060405280519060200120614a9690919063ffffffff16565b90508073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff161415156136cc576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260108152602001807f446966666572656e74207369676e65720000000000000000000000000000000081525060200191505060405180910390fd5b6136d4615bc7565b6136dd87614c1d565b90506136e7615bc7565b6136f086614c1d565b905080600001518260000151141515613771576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600f8152602001807f446966666572656e74206e6f6e6365000000000000000000000000000000000081525060200191505060405180910390fd5b60608260a001518360400151846060015185608001516040516020018085805190602001908083835b6020831015156137bf578051825260208201915060208101905060208303925061379a565b6001836020036101000a0380198251168184511680821785525050505050509050018481526020018373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c01000000000000000000000000028152601401828152602001945050505050604051602081830303815290604052905060608260a001518360400151846060015185608001516040516020018085805190602001908083835b602083101515613893578051825260208201915060208101905060208303925061386e565b6001836020036101000a0380198251168184511680821785525050505050509050018481526020018373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166c010000000000000000000000000281526014018281526020019450505050506040516020818303038152906040529050808051906020012082805190602001201415151561399f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600b8152602001807f747820697320657175616c00000000000000000000000000000000000000000081525060200191505060405180910390fd5b6139a886614cb1565b50505050505050505050565b6000349050671bc16d674ec800008111151515613a39576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600f8152602001807f6465706f73697420746f6f20626967000000000000000000000000000000000081525060200191505060405180910390fd5b613a82600260008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054826151eb565b600260008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020819055503373ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff167f8752a472e571a816aea92eec8dae9baf628e840f4929fbcc2d155e6233ff68a7836040518082815260200191505060405180910390a35050565b60006003811115613b3b57fe5b600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115613b9657fe5b1415613d29578173ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151515613c40576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252601d8152602001807f72656c61792063616e6e6f74207374616b6520666f7220697473656c6600000081525060200191505060405180910390fd5b33600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060018060008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160146101000a81548160ff02191690836003811115613d1f57fe5b0217905550613f80565b60016003811115613d3657fe5b600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115613d9157fe5b1480613e02575060026003811115613da557fe5b600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115613e0057fe5b145b15613f11573373ffffffffffffffffffffffffffffffffffffffff16600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16141515613f0c576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260098152602001807f6e6f74206f776e6572000000000000000000000000000000000000000000000081525060200191505060405180910390fd5b613f7f565b6040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260158152602001807f77726f6e6720737461746520666f72207374616b65000000000000000000000081525060200191505060405180910390fd5b5b600034905080600160008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060000160008282540192505081905550670de0b6b3a7640000600160008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000015410151515614097576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260188152602001807f7374616b65206c6f776572207468616e206d696e696d756d000000000000000081525060200191505060405180910390fd5b62093a808210151515614112576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260188152602001807f64656c6179206c6f776572207468616e206d696e696d756d000000000000000081525060200191505060405180910390fd5b626ebe00821115151561418d576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260198152602001807f64656c617920686967686572207468616e206d6178696d756d0000000000000081525060200191505060405180910390fd5b600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600101548210151515614247576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260208152602001807f756e7374616b6544656c61792063616e6e6f742062652064656372656173656481525060200191505060405180910390fd5b81600160008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600101819055508273ffffffffffffffffffffffffffffffffffffffff167f1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90600160008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060000154600160008773ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060010154604051808381526020018281526020019250505060405180910390a2505050565b3373ffffffffffffffffffffffffffffffffffffffff16600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16141515614472576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260098152602001807f6e6f74206f776e6572000000000000000000000000000000000000000000000081525060200191505060405180910390fd5b6001600381111561447f57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff1660038111156144da57fe5b148061454b5750600260038111156144ee57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff16600381111561454957fe5b145b15156145bf576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600f8152602001807f616c72656164792072656d6f766564000000000000000000000000000000000081525060200191505060405180910390fd5b42600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206001015401600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600201819055506003600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160146101000a81548160ff021916908360038111156146a957fe5b02179055508073ffffffffffffffffffffffffffffffffffffffff167f5490afc1d818789c8b3d5d63bce3d2a3327d0bba4efb5a7751f783dc977d7d11600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600201546040518082815260200191505060405180910390a250565b61474a816132c4565b15156147be576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260118152602001807f63616e556e7374616b65206661696c656400000000000000000000000000000081525060200191505060405180910390fd5b3373ffffffffffffffffffffffffffffffffffffffff16600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff161415156148c3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260098152602001807f6e6f74206f776e6572000000000000000000000000000000000000000000000081525060200191505060405180910390fd5b60003390506000600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600001549050600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600080820160009055600182016000905560028201600090556003820160006101000a81549073ffffffffffffffffffffffffffffffffffffffff02191690556003820160146101000a81549060ff021916905550508173ffffffffffffffffffffffffffffffffffffffff166108fc829081150290604051600060405180830381858888f193505050501580156149ea573d6000803e3d6000fd5b508273ffffffffffffffffffffffffffffffffffffffff167f0f5bb82176feb1b5e747e28471aa92156a04d9f3ab9f45f28e2d704232b93f75826040518082815260200191505060405180910390a2505050565b60008160405160200180807f19457468657265756d205369676e6564204d6573736167653a0a333200000000815250601c01828152602001915050604051602081830303815290604052805190602001209050919050565b600060418251141515614aac5760009050614b97565b60008060006020850151925060408501519150606085015160001a90507f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a082600190041115614b015760009350505050614b97565b601b8160ff1614158015614b195750601c8160ff1614155b15614b2a5760009350505050614b97565b60018682858560405160008152602001604052604051808581526020018460ff1660ff1681526020018381526020018281526020019450505050506020604051602081039080840390855afa158015614b87573d6000803e3d6000fd5b5050506020604051035193505050505b92915050565b60608160405160200180826004811115614bb357fe5b60ff16815260200191505060405160208183030381529060405290508051602082018181fd5b600081614be7576000614bf0565b611388620186a0015b8361bc4c0101905092915050565b600060648260640184860202811515614c1357fe5b0490509392505050565b614c25615bc7565b614c2e82615275565b809050866000018760200188604001896060018a6080018b60a001869052868152508673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815250868152508681525086815250505050505050809050919050565b6000614ca782600061536f565b6001029050919050565b60016003811115614cbe57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115614d1957fe5b1480614d8a575060026003811115614d2d57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115614d8857fe5b145b80614df95750600380811115614d9c57fe5b600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115614df757fe5b145b1515614e6d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600e8152602001807f556e7374616b65642072656c617900000000000000000000000000000000000081525060200191505060405180910390fd5b6000600160008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000015490506000614ec182600261538a565b90506000614ecf8383615140565b905060026003811115614ede57fe5b600160008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060030160149054906101000a900460ff166003811115614f3957fe5b1415614f8e578373ffffffffffffffffffffffffffffffffffffffff167f5490afc1d818789c8b3d5d63bce3d2a3327d0bba4efb5a7751f783dc977d7d11426040518082815260200191505060405180910390a25b600160008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600080820160009055600182016000905560028201600090556003820160006101000a81549073ffffffffffffffffffffffffffffffffffffffff02191690556003820160146101000a81549060ff02191690555050600073ffffffffffffffffffffffffffffffffffffffff166108fc839081150290604051600060405180830381858888f1935050505015801561506a573d6000803e3d6000fd5b5060003390508073ffffffffffffffffffffffffffffffffffffffff166108fc839081150290604051600060405180830381858888f193505050501580156150b6573d6000803e3d6000fd5b508473ffffffffffffffffffffffffffffffffffffffff167fb0595266ccec357806b2691f348b128209f1060a0bda4f5c95f7090730351ff88284604051808373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020018281526020019250505060405180910390a25050505050565b600061518283836040805190810160405280601e81526020017f536166654d6174683a207375627472616374696f6e206f766572666c6f7700008152506153d4565b905092915050565b600060048201835110156151b1576151b06151ab6003855160048601615496565b615551565b5b6020820191508183015190507fffffffff000000000000000000000000000000000000000000000000000000008116905080905092915050565b600080828401905083811015151561526b576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252601b8152602001807f536166654d6174683a206164646974696f6e206f766572666c6f77000000000081525060200191505060405180910390fd5b8091505092915050565b600080600080600060608061529161528c89615559565b6155b0565b90506152b48160008151811015156152a557fe5b906020019060200201516156f6565b6152d58260018151811015156152c657fe5b906020019060200201516156f6565b6152f68360028151811015156152e757fe5b906020019060200201516156f6565b61531784600381518110151561530857fe5b90602001906020020151615739565b61533885600481518110151561532957fe5b906020019060200201516156f6565b61535986600581518110151561534a57fe5b906020019060200201516157ee565b9650965096509650965096505091939550919395565b600061537b8383615869565b60019004905080905092915050565b60006153cc83836040805190810160405280601a81526020017f536166654d6174683a206469766973696f6e206279207a65726f0000000000008152506158a5565b905092915050565b60008383111582901515615483576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825283818151815260200191508051906020019080838360005b8381101561544857808201518184015260208101905061542d565b50505050905090810190601f1680156154755780820380516001836020036101000a031916815260200191505b509250505060405180910390fd5b5060008385039050809150509392505050565b606063280065957c010000000000000000000000000000000000000000000000000000000002848484604051602401808460078111156154d257fe5b60ff1681526020018381526020018281526020019350505050604051602081830303815290604052907bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff838183161783525050505090509392505050565b805160208201fd5b615561615c14565b60008251141561558957604080519081016040528060008152602001600081525090506155ab565b6000602083019050604080519081016040528084518152602001828152509150505b919050565b60606155bb8261596f565b151561562f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252600d8152602001807f69734c697374206661696c65640000000000000000000000000000000000000081525060200191505060405180910390fd5b600061563a836159a8565b90508060405190808252806020026020018201604052801561567657816020015b615663615c2e565b81526020019060019003908161565b5790505b50915060006156888460200151615a03565b8460200151019050600080600090505b838110156156ed576156a983615a8c565b915060408051908101604052808381526020018481525085828151811015156156ce57fe5b9060200190602002018190525081830192508080600101915050615698565b50505050919050565b6000806157068360200151615a03565b9050600081846000015103905060008285602001510190506000826020036101000a825104905080945050505050919050565b600060158260000151111515156157de576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040180806020018281038252603a8152602001807f496e76616c696420524c504974656d2e2041646472657373657320617265206581526020017f6e636f64656420696e203230206279746573206f72206c65737300000000000081525060400191505060405180910390fd5b6157e7826156f6565b9050919050565b606060006157ff8360200151615a03565b905060008184600001510390506060816040519080825280601f01601f1916602001820160405280156158415781602001600182028038833980820191505090505b509050600081602001905061585d848760200151018285615b3f565b81945050505050919050565b600060208201835110156158905761588f61588a6005855160208601615496565b615551565b5b60208201915081830151905080905092915050565b600080831182901515615953576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825283818151815260200191508051906020019080838360005b838110156159185780820151818401526020810190506158fd565b50505050905090810190601f1680156159455780820380516001836020036101000a031916815260200191505b509250505060405180910390fd5b506000838581151561596157fe5b049050809150509392505050565b600080600083602001519050805160001a915060c060ff168260ff16101561599c576000925050506159a3565b6001925050505b919050565b6000806000905060006159be8460200151615a03565b84602001510190506000846000015185602001510190505b808210156159f8576159e782615a8c565b8201915082806001019350506159d6565b829350505050919050565b600080825160001a9050608060ff16811015615a23576000915050615a87565b60b860ff16811080615a48575060c060ff168110158015615a47575060f860ff1681105b5b15615a57576001915050615a87565b60c060ff16811015615a775760018060b80360ff16820301915050615a87565b60018060f80360ff168203019150505b919050565b600080825160001a9050608060ff16811015615aac576001915050615b3a565b60b860ff16811015615aca576001608060ff16820301915050615b3a565b60c060ff16811015615afa5760b78103600184019350806020036101000a84510460018201810193505050615b38565b60f860ff16811015615b1857600160c060ff16820301915050615b3a565b60f78103600184019350806020036101000a845104600182018101935050505b505b919050565b5b602060ff1681101515615b715782518252602060ff1683019250602060ff1682019150602060ff1681039050615b40565b6000600182602060ff16036101000a0390508019845116818451168181178552505050505050565b6080604051908101604052806000815260200160008152602001600080191681526020016000151581525090565b60c060405190810160405280600081526020016000815260200160008152602001600073ffffffffffffffffffffffffffffffffffffffff16815260200160008152602001606081525090565b604080519081016040528060008152602001600081525090565b60408051908101604052806000815260200160008152509056fea165627a7a72305820db23b8eb7d58ca22b66e01ed968465ae44d3b6f8aacbb80fb40adf9ce157a0690029'
};

var database = /*#__PURE__*/function () {
  /**
   *
   * @param options
   */
  function database(options) {
    _classCallCheck(this, database);

    if (!(options.defaultWeb3 && options.ephemeralWeb3)) {
      throw new Error('Missing required constructor args');
    }
    /*
    ************************************************************************************************************
    * Passed In
    ************************************************************************************************************
     */


    this.databaseContractAddr = options.databaseContractAddr;
    this.relayHubAddr = options.relayHubAddr;
    /*
     This could be 1 of 2 possibilities
     1. The storage contract owner is running in a secure env and this is the owner of the storage contract.
        However for most of the developers they will have a Fortmatic account and need to export the priv key
        to take advantage of this, so they will be stuck using the ElastosJS GUI or import this into a custom
        app.
      2. This is deployed and the user is not the owner, most likely case.
     */

    this.defaultWeb3 = options.defaultWeb3; // this is the ephemeral signer for anonymous calls which don't prompt for a signature

    this.ephemeralWeb3 = options.ephemeralWeb3;
    /*
    ************************************************************************************************************
    * Internal
    ************************************************************************************************************
     */
    // default instance - points to ElastosJS contract

    this.defaultInstance = null; // ephemeral instance - points to ElastosJS contract

    this.ephemeralInstance = null;
    this.databaseContractABI = ELAJSStoreJSON.abi;
    this.databaseContractBytecode = ELAJSStoreJSON.bytecode;
    this.config = {
      gasPrice: '1000000000',
      gasLimit: 8000000
    };
    this.debug = options.debug || false; // TODO: we want to cache or use a Map, how to handle invalidating cache?
    // current idea is to save a block height with each schema update, all queries
    // that depend on the schema could pass in the last seen block height (version)
    // this.cache = {}

    this._initialize();
  }
  /*
   ******************************************************************************************************
   * Query Functions
   ******************************************************************************************************
   */


  _createClass(database, [{
    key: "getTables",
    value: function () {
      var _getTables = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee() {
        return _regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                _context.next = 2;
                return this.ephemeralInstance.methods.getTables().call();

              case 2:
                return _context.abrupt("return", _context.sent);

              case 3:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function getTables() {
        return _getTables.apply(this, arguments);
      }

      return getTables;
    }()
    /**
     * TODO: Returns a chainable select object, that finally resolves to a callable Promise
     */

  }, {
    key: "select",
    value: function select() {} // return this? - need to instantiate and return a new Class instance for chaining
    // pass a reference to elajs into the constructor?

    /**
     * @param tableName
     * @param id
     * @returns {Promise<void>}
     */

  }, {
    key: "getRow",
    value: function () {
      var _getRow = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee3(tableName, id) {
        var _this = this;

        var tableKey, tableSchema, colsPromises;
        return _regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                tableKey = namehash(tableName);
                _context3.next = 3;
                return this.ephemeralInstance.methods.getSchema(tableKey).call();

              case 3:
                tableSchema = _context3.sent;
                colsPromises = tableSchema.columns.map(function (colData) {
                  var fieldName = Web3.utils.hexToString(colData.name);
                  var fieldType = Web3.utils.hexToString(colData._dtype);
                  return _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee2() {
                    var val;
                    return _regeneratorRuntime.wrap(function _callee2$(_context2) {
                      while (1) {
                        switch (_context2.prev = _context2.next) {
                          case 0:
                            _context2.next = 2;
                            return _this.getVal(tableName, id, fieldName, fieldType);

                          case 2:
                            val = _context2.sent;
                            return _context2.abrupt("return", {
                              name: fieldName,
                              type: Web3.utils.hexToString(colData._dtype),
                              value: val
                            });

                          case 4:
                          case "end":
                            return _context2.stop();
                        }
                      }
                    }, _callee2);
                  }))();
                });
                return _context3.abrupt("return", Promise.all(colsPromises));

              case 6:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this);
      }));

      function getRow(_x, _x2) {
        return _getRow.apply(this, arguments);
      }

      return getRow;
    }()
    /**
     * The storage smart contract does not support auto_increment ids, therefore we
     * always generate randomBytes
     *
     * EPHEMERAL ONLY - TODO add ethAddress!
     *
     * TODO: we really want to return a Promise immediately, which resolves to all the inserts
     *
     * There are 3 types of tables
     * 1 = private, must be FORTMATIC signer and only works if it's the owner
     * 2 = public, can be any signer
     * 3 = shared, can be any signer
     *
     * @param tableName
     * @param cols Array of column names as STRINGS, name must be 32 chars or less
     * @param values - Array of values "as-is", we convert to bytes32 strings here
     * @param options - struct
     * @param options.signer
     *
     * @return the bytes32 id for the row
     */

  }, {
    key: "insertRow",
    value: function () {
      var _insertRow = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee5(tableName, cols, values, options) {
        var _defaultOptions, colsLen, id, _this$_getKeys, idKey, tableKey, schema, colTypeMap, web3eth, instance, ethAddress, nonceStart, promises, i, fieldKey, val;

        return _regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                _defaultOptions = {};
                colsLen = cols.length;
                options = Object.assign(_defaultOptions, options);

                if (!(options.id && (options.id.substring(0, 2) !== '0x' || options.id.length !== 66))) {
                  _context5.next = 5;
                  break;
                }

                throw new Error('options.id must be a 32 byte hex string prefixed with 0x');

              case 5:
                if (!(colsLen !== values.length)) {
                  _context5.next = 7;
                  break;
                }

                throw new Error('cols, values arrays must be same length');

              case 7:
                id = Web3.utils.randomHex(32);

                if (options.id) {
                  id = options.id;
                }

                _this$_getKeys = this._getKeys(tableName, id.substring(2)), idKey = _this$_getKeys.idKey, tableKey = _this$_getKeys.tableKey; // Be lazy for now and always check? TODO: add caching

                _context5.next = 12;
                return this.getTableSchema(tableName);

              case 12:
                schema = _context5.sent;
                // create a map of col name to type
                colTypeMap = new Map();
                schema.columns.map(function (colData) {
                  var colNameStr = Web3.utils.hexToString(colData.name);
                  var colType = Web3.utils.hexToString(colData._dtype);
                  colTypeMap.set(colNameStr, colType);
                });

                if (options.ethAddress) {
                  web3eth = this.defaultWeb3.eth;
                  instance = this.defaultInstance;
                  ethAddress = options.ethAddress;
                } else {
                  web3eth = this.ephemeralWeb3.lib.eth;
                  instance = this.ephemeralInstance;
                  ethAddress = this.ephemeralWeb3.accounts[0];
                } // TODO: parallel inserts with nonces


                _context5.next = 18;
                return web3eth.getTransactionCount(ethAddress, 'pending');

              case 18:
                nonceStart = _context5.sent;
                promises = [];

                for (i = 0; i < colsLen; i++) {
                  fieldKey = keccak256(cols[i]);
                  val = this.constructor.castType(colTypeMap.get(cols[i]), values[i]);

                  (function (val, fieldKey, i) {
                    promises.push(new Promise(function (resolve) {
                      setTimeout( /*#__PURE__*/_asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee4() {
                        return _regeneratorRuntime.wrap(function _callee4$(_context4) {
                          while (1) {
                            switch (_context4.prev = _context4.next) {
                              case 0:
                                _context4.t0 = resolve;
                                _context4.next = 3;
                                return instance.methods.insertVal(tableKey, idKey, fieldKey, id, val // we always insert bytes32 strings
                                ).send({
                                  from: ethAddress,
                                  nonce: nonceStart + i
                                });

                              case 3:
                                _context4.t1 = _context4.sent;
                                (0, _context4.t0)(_context4.t1);

                              case 5:
                              case "end":
                                return _context4.stop();
                            }
                          }
                        }, _callee4);
                      })), i * 10000);
                    }));
                  })(val, fieldKey, i);
                }

                _context5.next = 23;
                return Promise.all(promises);

              case 23:
                return _context5.abrupt("return", id);

              case 24:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function insertRow(_x3, _x4, _x5, _x6) {
        return _insertRow.apply(this, arguments);
      }

      return insertRow;
    }()
    /**
     * Non-async - returns a promise so you have more granular control over progress display on the client
     *
     * TODO: the promise should resolve with the fieldIdTableKey and transaction hash
     *
     * @param tableName
     * @param col
     * @param val
     * @param options
     * @returns {*}
     */

  }, {
    key: "insertVal",
    value: function insertVal(tableName, col, val, options) {
      if (options && options.id && (options.id.substring(0, 2) !== '0x' || options.id.length !== 66)) {
        throw new Error('options.id must be a 32 byte hex string prefixed with 0x');
      }

      var id = Web3.utils.randomHex(32);

      if (options && options.id) {
        id = options.id;
      }

      var _this$_getKeys2 = this._getKeys(tableName, id.substring(2)),
          idKey = _this$_getKeys2.idKey,
          tableKey = _this$_getKeys2.tableKey;

      var fieldKey = keccak256(col);
      return this.ephemeralInstance.methods.insertVal(tableKey, idKey, fieldKey, id, val).send({
        from: this.ephemeralWeb3.accounts[0]
      });
    }
  }, {
    key: "deleteRow",
    value: function deleteRow() {}
    /**
     * like _getVal but async and uses fieldType, which is from the schema
     */

  }, {
    key: "getVal",
    value: function () {
      var _getVal2 = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee6(tableName, id, fieldName, fieldType) {
        var val;
        return _regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                _context6.next = 2;
                return this._getVal(tableName, id, fieldName);

              case 2:
                val = _context6.sent;

                if (!fieldType) {
                  _context6.next = 13;
                  break;
                }

                _context6.t0 = fieldType;
                _context6.next = _context6.t0 === constants.FIELD_TYPE.UINT ? 7 : _context6.t0 === constants.FIELD_TYPE.STRING ? 9 : _context6.t0 === constants.FIELD_TYPE.BOOL ? 11 : 13;
                break;

              case 7:
                val = Web3.utils.hexToNumber(val);
                return _context6.abrupt("break", 13);

              case 9:
                val = Web3.utils.hexToString(val);
                return _context6.abrupt("break", 13);

              case 11:
                val = !!Web3.utils.hexToNumber(val);
                return _context6.abrupt("break", 13);

              case 13:
                return _context6.abrupt("return", val);

              case 14:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function getVal(_x7, _x8, _x9, _x10) {
        return _getVal2.apply(this, arguments);
      }

      return getVal;
    }()
    /*
    ************************************************************************************************************
    * Helpers - should not be called externally
    ************************************************************************************************************
     */

  }, {
    key: "_getKeys",
    value: function _getKeys(tableName, id) {
      if (id.substring(0, 2) === '0x') {
        throw new Error('internal fn _getKeys expects id without 0x prefix');
      }

      var idKey = keccak256(id);
      var tableKey = namehash(tableName);
      var idTableKey = namehash("".concat(id, ".").concat(tableName));
      return {
        idKey: idKey,
        tableKey: tableKey,
        idTableKey: idTableKey
      };
    }
    /**
     * Update a single val, should be called by another fn
     * @private
     */

  }, {
    key: "_updateVal",
    value: function _updateVal() {}
    /**
     * This is a call so we can always use ephemeral, has no type handling since this returns a promise
     *
     * @param tableName
     * @param id - Should not have leading 0x
     * @param fieldName
     * @private
     * @returns promise
     */

  }, {
    key: "_getVal",
    value: function _getVal(tableName, id, fieldName) {
      if (id.substring(0, 2) !== '0x' || id.length !== 66) {
        throw new Error('id must be a 32 byte hex string prefixed with 0x');
      } // always strip the 0x


      id = id.substring(2);
      var fieldIdTableKey = namehash("".concat(fieldName, ".").concat(id, ".").concat(tableName));
      return this.ephemeralInstance.methods.getRowValue(fieldIdTableKey).call();
    }
    /**
     * We should setup the web3 components if not passed in
     * @private
     */

  }, {
    key: "_initialize",
    value: function _initialize() {
      if (this.defaultWeb3 && this.databaseContractAddr) {
        this.defaultInstance = new this.defaultWeb3.eth.Contract(this.databaseContractABI, this.databaseContractAddr);
      }

      if (this.ephemeralWeb3 && this.databaseContractAddr) {
        this.ephemeralInstance = new this.ephemeralWeb3.lib.eth.Contract(this.databaseContractABI, this.databaseContractAddr);
      } // 1. fetch table list
      // 2. lazy fetch schema?

    }
    /*
    ************************************************************************************************************
    * Relay Hub
    ************************************************************************************************************
     */

  }, {
    key: "getGSNBalance",
    value: function () {
      var _getGSNBalance = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee7() {
        return _regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                _context7.next = 2;
                return this.ephemeralInstance.methods.getGSNBalance().call();

              case 2:
                return _context7.abrupt("return", _context7.sent);

              case 3:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function getGSNBalance() {
        return _getGSNBalance.apply(this, arguments);
      }

      return getGSNBalance;
    }()
    /**
     * @param fromAddress ethAddress to send funds from, should correspond to the defaultWeb3 instance
     * @param contractAddress
     * @param amount to add in Ether
     */

  }, {
    key: "addFunds",
    value: function addFunds(fromAddress, contractAddress, amount) {
      var relayHubAddress = this.relayHubAddr;
      var relayHubInstance = new this.defaultWeb3.eth.Contract(relayHubData.abi, relayHubAddress, {
        data: relayHubData.bytecode
      });
      var amtInWei = new Web3.utils.BN(Web3.utils.toWei(amount, 'ether'));
      return relayHubInstance.methods.depositFor(contractAddress).send({
        useGSN: false,
        value: amtInWei,
        from: fromAddress
      });
    }
    /**
     *
     * @param destAddress keep this the same as fromAddress, so user can only withdraw to their own address
     */

  }, {
    key: "withdrawAll",
    value: function withdrawAll(destAddress) {
      return this.defaultInstance.methods.withdrawAll(destAddress).send({
        useGSN: false,
        from: destAddress
      });
    }
    /*
    ************************************************************************************************************
    * Administrative - Changing Contracts, Deploying/Initializing
    ************************************************************************************************************
     */

    /**
     * It is very important that on additional/secondary ela-js instances that you call:
     *
     * await ethConfig.elajsUser.defaultWeb3.currentProvider.baseProvider.enable()
     *
     * This initializes the fortmatic web3 provider to sign transactions, but we won't do this
     * too presumptively since they may not be using Fortmatic
     *
     * TODO: we should possibly check if defaultInstance is formatic or Metamask at least (least not ephemeral)
     *
     * @param databaseContractAddr
     */

  }, {
    key: "setDatabase",
    value: function setDatabase(databaseContractAddr) {
      this.databaseContractAddr = databaseContractAddr;
      this.defaultInstance = new this.defaultWeb3.eth.Contract(this.databaseContractABI, databaseContractAddr);
      this.ephemeralInstance = new this.ephemeralWeb3.lib.eth.Contract(this.databaseContractABI, databaseContractAddr);
    }
    /**
     * TODO: revisit if we should be passing ethAddress, this is all client-side anyway though
     * @param ethAddress
     */

  }, {
    key: "deployDatabase",
    value: function deployDatabase(ethAddress) {
      var newContract = new this.defaultWeb3.eth.Contract(this.databaseContractABI);
      /*
      let fromAccount
       if (this.defaultWeb3.currentProvider &&
        this.defaultWeb3.currentProvider.baseProvider &&
        this.defaultWeb3.currentProvider.baseProvider.isFortmatic)
      {
        const ethAccounts = await this.defaultWeb3.eth.getAccounts()
         fromAccount = ethAccounts[0]
      } else {
        fromAccount = this.defaultWeb3.eth.personal.currentProvider.addresses[0]
      }
       */

      return newContract.deploy({
        data: this.databaseContractBytecode
      }).send({
        useGSN: false,
        from: ethAddress,
        gasPrice: this.config.gasPrice
      });
    }
    /**
     * Initialize newly deployed contract, must be called to retrieve GSN Balance
     *
     * @param ethAddress - from address which will pay for this non-GSN transaction
     */

  }, {
    key: "initializeContract",
    value: function initializeContract(ethAddress) {
      if (!this.relayHubAddr) {
        throw new Error('Missing relayHub address');
      } // console.log(ethAddress, this.defaultInstance)


      return this.defaultInstance.methods.initialize(this.relayHubAddr).send({
        useGSN: false,
        from: ethAddress,
        gasPrice: this.config.gasPrice,
        gasLimit: 250000
      });
    }
    /*
    ************************************************************************************************************
    * Schema - Create, Update, Remove Table
    ************************************************************************************************************
     */

    /**
     * fm call only
     *
     * we pass in ethAddress because we don't wait to wait for a fortmatic async fetch for ethAccounts
     *
     * @param tableName
     * @param permission - INT 1, 2, or 3
     * @param cols - array of BYTES32 Strings TODO: change this
     * @param colTypes - array of BYTES32 Strings TODO: change this
     * @param ethAddress
     * @returns {*}
     */

  }, {
    key: "createTable",
    value: function createTable(tableName, permission, cols, colTypes, ethAddress) {
      if (check.not.inRange(permission, 1, 3)) {
        throw new Error("createTable - permission value \"".concat(permission, "\" wrong"));
      }

      var tableNameValue = Web3.utils.stringToHex(tableName);
      var tableKey = namehash(tableName);

      if (cols.length !== colTypes.length) {
        throw new Error('cols and colTypes array length mismatch');
      }

      var colsBytes32 = cols.map(Web3.utils.stringToHex);
      var colTypesBytes32 = colTypes.map(Web3.utils.stringToHex);
      return this.defaultInstance.methods.createTable(tableNameValue, tableKey, permission, colsBytes32, colTypesBytes32).send({
        useGSN: false,
        from: ethAddress || this.defaultWeb3.eth.personal.currentProvider.addresses[0],
        gasPrice: this.config.gasPrice,
        gas: 1500000
      });
    }
  }, {
    key: "getTableMetadata",
    value: function () {
      var _getTableMetadata = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee8(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                tableKey = namehash(tableName);
                _context8.next = 3;
                return this.ephemeralInstance.methods.getTableMetadata(tableKey).call();

              case 3:
                return _context8.abrupt("return", _context8.sent);

              case 4:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this);
      }));

      function getTableMetadata(_x11) {
        return _getTableMetadata.apply(this, arguments);
      }

      return getTableMetadata;
    }()
  }, {
    key: "getTableSchema",
    value: function () {
      var _getTableSchema = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee9(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                tableKey = namehash(tableName);
                _context9.next = 3;
                return this.ephemeralInstance.methods.getSchema(tableKey).call();

              case 3:
                return _context9.abrupt("return", _context9.sent);

              case 4:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this);
      }));

      function getTableSchema(_x12) {
        return _getTableSchema.apply(this, arguments);
      }

      return getTableSchema;
    }()
  }, {
    key: "getTableIds",
    value: function () {
      var _getTableIds = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee10(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee10$(_context10) {
          while (1) {
            switch (_context10.prev = _context10.next) {
              case 0:
                tableKey = namehash(tableName);
                _context10.next = 3;
                return this.ephemeralInstance.methods.getTableIds(tableKey).call();

              case 3:
                return _context10.abrupt("return", _context10.sent);

              case 4:
              case "end":
                return _context10.stop();
            }
          }
        }, _callee10, this);
      }));

      function getTableIds(_x13) {
        return _getTableIds.apply(this, arguments);
      }

      return getTableIds;
    }()
    /**
     * Known types are:
     * - BYTES32
     * - STRING
     * - UINT
     * - BOOL
     *
     * @param colType
     * @param val
     *
     * @return bytes32 string
     */

  }], [{
    key: "castType",
    value: function castType(colType, val) {
      switch (colType) {
        // we don't really expect to do anything for BYTES32,
        // just make sure it's a bytes32 string
        case constants.FIELD_TYPE.BYTES32:
          if (check.not.string(val)) {
            throw new Error('BYTES32 expects a string starting with 0x');
          }

          if (val.length !== 66) {
            throw new Error('BYTES32 expects a string with length 66');
          }

          return val;

        case constants.FIELD_TYPE.UINT:
          if (check.not.integer(val) || check.not.greaterOrEqual(val, 0)) {
            throw new Error('UINT expects 0 or positive integers');
          }

          return uintToBytes32(val);

        case constants.FIELD_TYPE.STRING:
          if (check.not.string(val)) {
            throw new Error('STRING expects a string');
          }

          if (check.not.lessOrEqual(val.length, 32)) {
            throw new Error('STRING max chars is 32');
          }

          return Web3.utils.stringToHex(val);

        case constants.FIELD_TYPE.BOOL:
          if (check.not["boolean"](val)) {
            throw new Error('BOOL expects a boolean');
          }

          return uintToBytes32(val ? 1 : 0);

        default:
          throw new Error("colType: \"".concat(colType, "\" not recognized"));
      }
    }
    /**
     * Known types are:
     * - BYTES32
     * - STRING
     * - UINT
     * - BOOL
     *
     * @param colType
     * @param val
     */

  }, {
    key: "checkType",
    value: function checkType(colType, val) {
      switch (colType) {
        // we expect
        case constants.FIELD_TYPE.BYTES32:
          if (check.not.string(val)) {
            throw new Error('BYTES32 expects a string starting with 0x');
          }

          if (val.length !== 66) {
            throw new Error('BYTES32 expects a string with length 66');
          }

          break;

        case constants.FIELD_TYPE.UINT:
          val = Web3.utils.hexToNumber(val);

          if (check.not.integer(val) || check.not.greaterOrEqual(val, 0)) {
            throw new Error('UINT expects 0 or positive integers');
          }

          break;

        case constants.FIELD_TYPE.STRING:
          val = Web3.utils.hexToString(val);

          if (check.not.string(val)) {
            throw new Error('STRING expects a string');
          } // TODO check string length <= 32


          break;

        case constants.FIELD_TYPE.BOOL:
          if (check.not["boolean"](val)) {
            throw new Error('BOOL expects a boolean');
          }

          break;

        default:
          throw new Error("colType: \"".concat(colType, "\" not recognized"));
      }

      return true;
    }
  }]);

  return database;
}();

/**
 * Under Development
 *
 * TODO: consistent returns of promise
 * - Must support ephemeral (anonymous calls)
 * - Needs to have a way to connect to Fortmatic
 * - We always expect the parent app to pass in the ozWeb3 and fmWeb3?
 * - do we track state and an entire table schema? cached?
 * - web3 should definitely be external, we pass it in and instantiate the contract
 *
 * Design Principles
 * -  elajs should not know about which network it's connected to, the web3 providers
 *    are all passed in. The developer is responsible for setting the contract addresses
 *    associated with their network as well.
 */

var elajs = {
  database: database
};

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

var exports = _objectSpread({
  elajs: elajs,
  namehash: namehash,
  keccak256: keccak256
}, bytesToTypes, {
  uintToBytes32: uintToBytes32
});

export default exports;
