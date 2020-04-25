import _defineProperty from '@babel/runtime/helpers/defineProperty';
import _ from 'lodash';
import _regeneratorRuntime from '@babel/runtime/regenerator';
import _asyncToGenerator from '@babel/runtime/helpers/asyncToGenerator';
import _classCallCheck from '@babel/runtime/helpers/classCallCheck';
import _createClass from '@babel/runtime/helpers/createClass';
import Web3 from 'web3';

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

// not really needed - use Web3.utils.stringToHex
var strToBytes32 = function strToBytes32(input) {
  var targetBuf = new Buffer.alloc(32);
  var inputBuf = new Buffer.from(input);
  var inputByteLen = inputBuf.byteLength; // overflow isn't written

  inputBuf.copy(targetBuf, inputByteLen < 32 ? 32 - inputByteLen : 0);
  return targetBuf;
};

var uintToBytes32 = function uintToBytes32(input) {
  var inputBuf = new Buffer.alloc(4);
  inputBuf.writeUInt32BE(input);
  var targetBuf = new Buffer.alloc(32);
  inputBuf.copy(targetBuf, 28);
  return targetBuf;
};

var typesToBytes = {
  strToBytes32: strToBytes32,
  uintToBytes32: uintToBytes32
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
var source = "pragma solidity ^0.5.0;\npragma experimental ABIEncoderV2;\n\nimport \"sol-datastructs/src/contracts/PolymorphicDictionaryLib.sol\";\n\n// import \"sol-datastructs/src/contracts/Bytes32DictionaryLib.sol\";\nimport \"sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol\";\n\n// import \"./oz/EnumerableSetDictionary.sol\";\n\nimport \"sol-sql/src/contracts/src/structs/TableLib.sol\";\n\nimport \"./ozEla/OwnableELA.sol\";\nimport \"./gsnEla/GSNRecipientELA.sol\";\nimport \"./gsnEla/IRelayHubELA.sol\";\n\ncontract DateTime {\n    function getYear(uint timestamp) public pure returns (uint16);\n    function getMonth(uint timestamp) public pure returns (uint8);\n    function getDay(uint timestamp) public pure returns (uint8);\n}\n\n// TODO: move schema methods to another contract, we're hitting limits for this\n// TODO: good practice to have functions not callable externally and internally\ncontract ELAJSStore is OwnableELA, GSNRecipientELA {\n\n    // TODO: have a dynamic mode to only use Events -> https://thegraph.com\n    // bool public useEvents = false;\n\n    // DateTime Contract address\n    // address constant public dateTimeAddr = 0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B; // development\n    // address constant public dateTimeAddr = 0xEDb211a2dBbdE62012440177e65b68E0A66E4531; // testnet\n\n    // Initialize the DateTime contract ABI with the already deployed contract\n    DateTime dateTime;\n\n    // This counts the number of times this contract was called via GSN (expended owner gas) for rate limiting\n    // mapping is a keccak256('YYYY-MM-DD') => uint (TODO: we can probably compress this by week (4 bytes per day -> 28 bytes)\n    mapping(bytes32 => uint256) public gsnCounter;\n\n    // Max times we allow this to be called per day\n    uint40 public gsnMaxCallsPerDay;\n\n    using PolymorphicDictionaryLib for PolymorphicDictionaryLib.PolymorphicDictionary;\n    using Bytes32SetDictionaryLib for Bytes32SetDictionaryLib.Bytes32SetDictionary;\n\n    // _table = system table (bytes32 Dict) of each table's metadata marshaled\n    // 8 bits - permissions (00 = system, 01 = private, 10 = public, 11 = shared - owner can always edit)\n    // 20 bytes - address delegate - other address allowed to edit\n    mapping(bytes32 => bytes32) internal _table;\n\n    // table = dict, where the key is the table, and the value is a set of byte32 ids\n    Bytes32SetDictionaryLib.Bytes32SetDictionary internal tableId;\n\n    // Schema dictionary, key (schemasPublicTables) points to a set of table names\n    using TableLib for TableLib.Table;\n    using TableLib for bytes;\n    // using ColumnLib for ColumnLib.Column;\n    // using ColumnLib for bytes;\n\n    // schemaTables -> Set of tables (raw table name values) for enumeration\n    bytes32 constant public schemasTables = 0x736368656d61732e7075626c69632e7461626c65730000000000000000000000;\n\n    // namehash([tableName]) => encoded table schema\n    // ownership of each row (id) - key = namehash([id].[table]) which has a value that is the owner's address\n    // ultimately namehash([field].[id].[table]) gives us a bytes32 which maps to the single data value\n    PolymorphicDictionaryLib.PolymorphicDictionary internal database;\n\n\n    // ************************************* SETUP FUNCTIONS *************************************\n    function initialize(address relayHubAddr, address dateTimeAddr) public initializer {\n        dateTime = DateTime(dateTimeAddr);\n        OwnableELA.initialize(msg.sender);\n        GSNRecipientELA.initialize(relayHubAddr);\n        _initialize();\n    }\n\n    function _initialize() internal {\n        gsnMaxCallsPerDay = 1000;\n\n        // init the key for schemasTables, our set is one-to-many-fixed, so table names must be max 32 bytes\n        database.addKey(schemasTables, PolymorphicDictionaryLib.DictionaryType.OneToManyFixed);\n    }\n\n    // ************************************* SCHEMA FUNCTIONS *************************************\n    /**\n     * @dev create a new table, only the owner may create this\n     *\n     * @param tableName right padded zeroes (Web3.utils.stringToHex)\n     * @param tableKey this is the namehash of tableName\n     */\n    function createTable(\n        bytes32 tableName,\n        bytes32 tableKey,\n        uint8 permission,\n        bytes32[] memory columnName,\n        bytes32[] memory columnDtype\n\n    ) public onlyOwner {\n\n        // this only works if tableName is trimmed of padding zeroes, since this is an onlyOwner call we won't bother\n        // require(isNamehashSubOf(keccak256(tableNameBytes), bytes32(0), tableKey), \"tableName does not match tableKey\");\n\n        // check if table exists\n        require(_table[tableKey] == 0, \"Table already exists\");\n\n        address delegate = address(0x0);\n\n        // claim the key slot and set the metadata\n        setTableMetadata(tableKey, permission, delegate);\n\n        database.addValueForKey(schemasTables, tableName);\n\n        // table stores the row ids set as the value, set up the key\n        tableId.addKey(tableKey);\n\n        // now insert the schema\n        saveSchema(tableName, tableKey, columnName, columnDtype);\n    }\n\n    // TODO: this isn't complete\n    function deleteTable(\n        bytes32 tableName,\n        bytes32 tableKey\n    ) public onlyOwner {\n        _table[tableKey] = 0;\n        database.removeValueForKey(schemasTables, tableName);\n        tableId.removeKey(tableKey);\n    }\n\n    function getTables() external view returns (bytes32[] memory){\n        return database.enumerateForKeyOneToManyFixed(schemasTables);\n    }\n\n    /*\n    function tableExists(bytes32 tableKey) public view returns (bool) {\n        return tableId.containsKey(tableKey);\n    }\n    */\n\n    function saveSchema(\n        bytes32 tableName,\n        bytes32 tableKey,\n        bytes32[] memory columnName,\n        bytes32[] memory columnDtype\n\n    ) public onlyOwner returns (bool) {\n\n        TableLib.Table memory tableSchema = TableLib.create(\n            tableName,\n            columnName,\n            columnDtype\n        );\n\n        bytes memory encoded = tableSchema.encode();\n\n        // we store the encoded table schema on the base tableKey\n        return database.setValueForKey(tableKey, encoded);\n    }\n\n    // EXPERIMENTAL\n    function getSchema(bytes32 _name) public view returns (TableLib.Table memory) {\n        bytes memory encoded = database.getBytesForKey(_name);\n        return encoded.decodeTable();\n    }\n\n    // ************************************* CRUD FUNCTIONS *************************************\n\n    /**\n     * @dev Table level permission checks\n     */\n    modifier insertCheck(bytes32 tableKey) {\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot INSERT into system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can INSERT into this table\");\n\n        _;\n    }\n\n\n    /**\n     * Primarily exists to assist in query WHERE searches, therefore we\n     * want the index to exist on the value and table, filtering on owner\n     * is important for performance\n     */\n    event InsertVal (\n        bytes32 indexed tableKey,\n        bytes32 indexed fieldKey,\n        bytes32 indexed val,\n\n        bytes32 id,\n\n        address owner\n    );\n\n\n    /**\n     * @dev Prior to insert, we check the permissions and autoIncrement\n     * TODO: use the schema and determine the proper type of data to insert\n     *\n     * @param tableKey the namehashed [table] name string\n     * @param idKey the sha3 hashed idKey\n     * @param id as the raw string (unhashed)\n     */\n    function insertVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes32 val)\n\n    public insertCheck(tableKey){\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        require(database.containsKey(fieldIdTableKey) == false, \"id+field already exists\");\n\n        // increment counter\n        increaseGsnCounter();\n\n        // add an id entry to the table's set of ids for the row (this is a set so we don't need to check first)\n        // TODO: should we check the id/row ownership?\n        tableId.addValueForKey(tableKey, id);\n\n        // add the \"row owner\" if it doesn't exist, the row may already exist in which case we don't update it\n        if (database.containsKey(idTableKey) == false){\n            _setRowOwner(idTableKey, id, tableKey);\n        }\n\n        // finally set the data\n        // we won't serialize the type, that's way too much redundant data\n        database.setValueForKey(fieldIdTableKey, bytes32(val));\n\n        // emit an event to assist in queries\n        emit InsertVal(tableKey, fieldKey, val, id, _msgSender());\n\n    }\n\n    function insertValVar(\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes memory val)\n\n    public insertCheck(tableKey){\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        require(database.containsKey(fieldIdTableKey) == false, \"id+field already exists\");\n\n        // increment counter\n        increaseGsnCounter();\n\n        // add an id entry to the table's set of ids for the row\n        tableId.addValueForKey(tableKey, id);\n\n        // add the \"row owner\" if it doesn't exist, the row may already exist in which case we don't update it\n        if (database.containsKey(idTableKey) == false){\n            _setRowOwner(idTableKey, id, tableKey);\n        }\n\n        // finally set the data\n        database.setValueForKey(fieldIdTableKey, val);\n    }\n\n    /**\n     * @dev we are essentially claiming this [id].[table] for the msg.sender, and setting the id createdDate\n     */\n    function _setRowOwner(bytes32 idTableKey, bytes32 id, bytes32 tableKey) internal {\n\n        require(database.containsKey(idTableKey) == false, \"row already has owner\");\n\n        uint256 rowMetadata;\n\n        uint16 year = dateTime.getYear(now);\n        uint8 month = dateTime.getMonth(now);\n        uint8 day = dateTime.getDay(now);\n\n        rowMetadata |= year;\n        rowMetadata |= uint256(month)<<16;\n        rowMetadata |= uint256(day)<<24;\n\n        bytes4 createdDate = bytes4(uint32(rowMetadata));\n\n        rowMetadata |= uint256(_msgSender())<<32;\n\n        database.setValueForKey(idTableKey, bytes32(rowMetadata));\n\n        // emit InsertRow(id, tableKey, _msgSender());\n    }\n\n    /**\n     * Primarily to assist querying all ids belonging to an owner\n     */\n    /*\n    event InsertRow (\n        bytes32 indexed _id,\n        bytes32 indexed _tableKey,\n        address indexed _rowOwner\n    );\n    */\n\n    function getRowOwner(bytes32 idTableKey) external returns (address rowOwner, bytes4 createdDate){\n\n        uint256 rowMetadata = uint256(database.getBytes32ForKey(idTableKey));\n\n        createdDate = bytes4(uint32(rowMetadata));\n        rowOwner = address(rowMetadata>>32);\n\n    }\n\n    function updateCheck(bytes32 tableKey, bytes32 idKey, bytes32 idTableKey, bytes32 id) internal {\n\n        require(tableId.containsValueForKey(tableKey, id) == true, \"id doesn't exist, use INSERT\");\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot UPDATE system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can UPDATE into this table\");\n\n        // permissions check (public table = 2, shared table = 3),\n        // if 2 or 3 is the _msg.sender() the row owner? But if 3 owner() is always allowed\n        if (permission >= 2) {\n\n            // rowMetaData is packed as address (bytes20) + createdDate (bytes4)\n            bytes32 rowMetaData = database.getBytes32ForKey(idTableKey);\n            address rowOwner = address(uint256(rowMetaData)>>32);\n\n            // if either 2 or 3, if you're the row owner it's fine\n            if (rowOwner == _msgSender()){\n                // pass\n            } else {\n                require(isOwner() == true || delegate == _msgSender(), \"Not rowOwner or owner/delegate for UPDATE into this table\");\n            }\n        }\n    }\n\n    function updateVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id,\n        bytes32 val)\n\n    public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        updateCheck(tableKey, idKey, idTableKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // set data (overwrite)\n        database.setValueForKey(fieldIdTableKey, bytes32(val));\n\n        // emit an event to assist in queries\n        emit InsertVal(tableKey, fieldKey, val, id, _msgSender());\n    }\n\n    function deleteCheck(bytes32 tableKey, bytes32 idTableKey, bytes32 idKey, bytes32 id) internal {\n\n        require(tableId.containsValueForKey(tableKey, id) == true, \"id doesn't exist\");\n\n        (uint256 permission, address delegate) = getTableMetadata(tableKey);\n\n        // if permission = 0, system table we can't do anything\n        require(permission > 0, \"Cannot DELETE from system table\");\n\n        // if permission = 1, we must be the owner/delegate\n        require(permission > 1 || isOwner() == true || delegate == _msgSender(), \"Only owner/delegate can DELETE from this table\");\n\n        // permissions check (public table = 2, shared table = 3),\n        // if 2 or 3 is the _msg.sender() the row owner? But if 3 owner() is always allowed\n        if (permission >= 2) {\n            if (isOwner() || delegate == _msgSender()){\n                // pass\n            } else {\n                // rowMetaData is packed as address (bytes20) + createdDate (bytes4)\n                bytes32 rowMetaData = database.getBytes32ForKey(idTableKey);\n                address rowOwner = address(uint256(rowMetaData)>>32);\n                require(rowOwner == _msgSender(), \"Sender not owner of row\");\n            }\n        }\n    }\n\n    /**\n     * @dev TODO: add modifier checks based on update\n     *\n     * TODO: this needs to properly remove the row when there are multiple ids\n     *\n     */\n    function deleteVal(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 fieldKey,\n\n        bytes32 id\n\n    ) public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n        bytes32 fieldIdTableKey = namehash(fieldKey, idTableKey);\n\n        deleteCheck(tableKey, idTableKey, idKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // remove the key\n        bool removed = database.removeKey(fieldIdTableKey);\n\n        require(removed == true, \"error removing key\");\n\n        // TODO: zero out the data? Why bother everything is public\n\n        // we can't really pass in enough data to make a loop worthwhile\n        /*\n        uint8 len = uint8(fieldKeys.length);\n        require(fieldKeys.length == fieldIdTableKeys.length, \"fields, id array length mismatch\");\n        for (uint8 i = 0; i < len; i++) {\n\n            // for each row check if the full field + id + table is a subhash\n            // require(isNamehashSubOf(fieldKeys[i], idTableKey, fieldIdTableKeys[i]) == true, \"fieldKey not a subhash [field].[id].[table]\");\n\n            // zero out the data\n            elajsStore[fieldIdTableKeys[i]] = bytes32(0);\n        }\n        */\n    }\n\n    // TODO: improve this, we don't want to cause data consistency if the client doesn't call this\n    // Right now we manually call this, but ideally we iterate over all the data and delete each column\n    // but this would require decoding and having all the field names\n    function deleteRow(\n\n        bytes32 tableKey,\n        bytes32 idKey,\n        bytes32 id\n\n    ) public {\n\n        bytes32 idTableKey = namehash(idKey, tableKey);\n\n        deleteCheck(tableKey, idTableKey, idKey, id);\n\n        // increment counter\n        increaseGsnCounter();\n\n        // remove the id\n        tableId.removeValueForKey(tableKey, id);\n    }\n\n    /**\n     * @dev Table actual insert call, NOTE this doesn't work on testnet currently due to a stack size issue,\n     *      but it can work with a paid transaction I guess\n     */\n    /*\n    function insert(\n        bytes32 tableKey,\n        bytes32 idTableKey,\n\n        bytes32 idKey,\n        bytes32 id,\n\n        bytes32[] memory fieldKeys,\n        bytes32[] memory fieldIdTableKeys,\n        bytes32[] memory values)\n\n    public insertCheck(tableKey, idKey, idTableKey){\n\n        require(table.containsValueForKey(tableKey, id) == false, \"id already exists\");\n\n        uint len = fieldKeys.length;\n\n        require(fieldKeys.length == fieldIdTableKeys.length == values.length, \"fields, values array length mismatch\");\n\n        // add an id entry to the table's set of ids for the row\n        table.addValueForKey(tableKey, id);\n\n        for (uint i = 0; i < len; i++) {\n\n            // for each row check if the full field + id + table is a subhash\n            require(isNamehashSubOf(fieldKeys[i], idTableKey, fieldIdTableKeys[i]) == true, \"fieldKey not a subhash [field].[id].[table]\");\n\n            elajsStore[fieldIdTableKeys[i]] = bytes32(values[i]);\n        }\n\n    }\n    */\n\n    /*\n    function getAllDataKeys() external view returns (bytes32[] memory) {\n        return database.enumerate();\n    }\n    */\n\n    function checkDataKey(bytes32 key) external view returns (bool) {\n        return database.containsKey(key);\n    }\n\n    /**\n     * @dev all data is public, so no need for security checks, we leave the data type handling to the client\n     */\n    function getRowValue(bytes32 fieldIdTableKey) external view returns (bytes32) {\n\n        if (database.containsKey(fieldIdTableKey)) {\n            return database.getBytes32ForKey(fieldIdTableKey);\n        } else {\n            return bytes32(0);\n        }\n    }\n\n    function getRowValueVar(bytes32 fieldIdTableKey) external view returns (bytes memory) {\n\n        if (database.containsKey(fieldIdTableKey)) {\n            return database.getBytesForKey(fieldIdTableKey);\n        } else {\n            return new bytes(0);\n        }\n    }\n\n    /**\n     * @dev Warning this produces an Error: overflow (operation=\"setValue\", fault=\"overflow\", details=\"Number can only safely store up to 53 bits\")\n     *      if the table doesn't exist\n     */\n    function getTableIds(bytes32 tableKey) external view returns (bytes32[] memory){\n\n        require(tableId.containsKey(tableKey) == true, \"table not created\");\n\n        return tableId.enumerateForKey(tableKey);\n    }\n\n    function getIdExists(bytes32 tableKey, bytes32 id) external view returns (bool) {\n        return tableId.containsValueForKey(tableKey, id);\n    }\n\n    /*\n    function isNamehashSubOf(bytes32 subKey, bytes32 base, bytes32 target) internal pure returns (bool) {\n        bytes32 result = namehash(subKey, base);\n        return result == target;\n    }\n    */\n\n    function namehash(bytes32 subKey, bytes32 base) internal pure returns (bytes32) {\n        bytes memory concat = new bytes(64);\n\n        assembly {\n            mstore(add(concat, 64), subKey)\n            mstore(add(concat, 32), base)\n        }\n\n        bytes32 result = keccak256(concat);\n\n        return result;\n    }\n\n    // ************************************* _TABLE FUNCTIONS *************************************\n    function getTableMetadata(bytes32 _tableKey)\n        view\n        public\n        returns (uint256 permission, address delegate)\n    {\n        require(_table[_tableKey] > 0, \"table does not exist\");\n\n        uint256 tableMetadata = uint256(_table[_tableKey]);\n\n        permission = uint256(uint8(tableMetadata));\n        delegate = address(tableMetadata>>8);\n    }\n\n    // TODO: we want to add the schema updated time here, then we can have a reliable schema cache\n    function setTableMetadata(bytes32 _tableKey, uint8 permission, address delegate) private onlyOwner {\n        uint256 tableMetadata;\n\n        tableMetadata |= permission;\n        tableMetadata |= uint160(delegate)<<8;\n\n        _table[_tableKey] = bytes32(tableMetadata);\n    }\n\n    // ************************************* MISC FUNCTIONS *************************************\n\n    function() external payable {}\n\n    // ************************************* GSN FUNCTIONS *************************************\n\n    /**\n     * As a first layer of defense we employ a max number of checks per day\n     */\n    function acceptRelayedCall(\n        address relay,\n        address from,\n        bytes calldata encodedFunction,\n        uint256 transactionFee,\n        uint256 gasPrice,\n        uint256 gasLimit,\n        uint256 nonce,\n        bytes calldata approvalData,\n        uint256 maxPossibleCharge\n    ) external view returns (uint256, bytes memory) {\n\n        bytes32 curDateHashed = getGsnCounter();\n\n        // check gsnCounter for today and compare to limit\n        uint256 curCounter = gsnCounter[curDateHashed];\n\n        if (curCounter >= gsnMaxCallsPerDay){\n            return _rejectRelayedCall(2);\n        }\n\n\n        return _approveRelayedCall();\n    }\n\n    function setGsnMaxCallsPerDay(uint256 max) external onlyOwner {\n        gsnMaxCallsPerDay = uint40(max);\n    }\n\n    /*\n    event GsnCounterIncrease (\n        address indexed _from,\n        bytes4 indexed curDate\n    );\n    */\n\n    /**\n     * Increase the GSN Counter for today\n     */\n    function increaseGsnCounter() internal {\n\n        bytes32 curDateHashed = getGsnCounter();\n\n        uint256 curCounter = gsnCounter[curDateHashed];\n\n        gsnCounter[curDateHashed] = curCounter + 1;\n\n        // emit GsnCounterIncrease(_msgSender(), bytes4(uint32(curDate)));\n    }\n\n    /*\n     *\n     */\n    function getGsnCounter() internal view returns (bytes32 curDateHashed) {\n\n        uint256 curDate;\n\n        uint16 year = dateTime.getYear(now);\n        uint8 month = dateTime.getMonth(now);\n        uint8 day = dateTime.getDay(now);\n\n        curDate |= year;\n        curDate |= uint256(month)<<16;\n        curDate |= uint256(day)<<24;\n\n        curDateHashed = keccak256(abi.encodePacked(curDate));\n    }\n\n    // We won't do any pre or post processing, so leave _preRelayedCall and _postRelayedCall empty\n    function _preRelayedCall(bytes memory context) internal returns (bytes32) {\n    }\n\n    function _postRelayedCall(bytes memory context, bool, uint256 actualCharge, bytes32) internal {\n    }\n\n    /**\n     * @dev Withdraw a specific amount of the GSNReceipient funds\n     * @param amt Amount of wei to withdraw\n     * @param dest This is the arbitrary withdrawal destination address\n     */\n    function withdraw(uint256 amt, address payable dest) public onlyOwner {\n        IRelayHubELA relayHub = getRelayHub();\n        relayHub.withdraw(amt, dest);\n    }\n\n    /**\n     * @dev Withdraw all the GSNReceipient funds\n     * @param dest This is the arbitrary withdrawal destination address\n     */\n    function withdrawAll(address payable dest) public onlyOwner returns (uint256) {\n        IRelayHubELA relayHub = getRelayHub();\n        uint256 balance = getRelayHub().balanceOf(address(this));\n        relayHub.withdraw(balance, dest);\n        return balance;\n    }\n\n    function getGSNBalance() public view returns (uint256) {\n        return getRelayHub().balanceOf(address(this));\n    }\n\n    function getRelayHub() internal view returns (IRelayHubELA) {\n        return IRelayHubELA(_getRelayHub());\n    }\n}\n";
var sourcePath = "contracts/ELAJSStore.sol";
var sourceMap = "862:22752:1:-;;;;;;;;;";
var deployedSourceMap = "862:22752:1:-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;22802:162;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22802:162:1;;;;;;;;;;;;;;;;;;;1720:31;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1720:31:1;;;;;;;;;;;;;;;;;;;;17576:113;;8:9:-1;5:2;;;30:1;27;20:12;5:2;17576:113:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;5339:138;;8:9:-1;5:2;;;30:1;27;20:12;5:2;5339:138:1;;;;;;;;;;;;;;;;;;;;10801:280;;8:9:-1;5:2;;;30:1;27;20:12;5:2;10801:280:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;4099:962;;8:9:-1;5:2;;;30:1;27;20:12;5:2;4099:962:1;;;;;;;;;;;;;;;;;;;23377:117;;8:9:-1;5:2;;;30:1;27;20:12;5:2;23377:117:1;;;;;;;;;;;;;;;;;;;;8863:891;;8:9:-1;5:2;;;30:1;27;20:12;5:2;8863:891:1;;;;;;;;;;;;;;;;;;;2695:106;;8:9:-1;5:2;;;30:1;27;20:12;5:2;2695:106:1;;;;;;;;;;;;;;;;;;;;3247:249;;8:9:-1;5:2;;;30:1;27;20:12;5:2;3247:249:1;;;;;;;;;;;;;;;;;;;1616:45;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1616:45:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;17821:260;;8:9:-1;5:2;;;30:1;27;20:12;5:2;17821:260:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;1724:137:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1724:137:15;;;;;;621:90:6;;8:9:-1;5:2;;;30:1;27;20:12;5:2;621:90:6;;;;;;;;;;;;;;;;;;;;5622:518:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;5622:518:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;12420:606;;8:9:-1;5:2;;;30:1;27;20:12;5:2;12420:606:1;;;;;;;;;;;;;;;;;;;945:210:9;;8:9:-1;5:2;;;30:1;27;20:12;5:2;945:210:9;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;15894:357:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;15894:357:1;;;;;;;;;;;;;;;;;;;20642:655;;8:9:-1;5:2;;;30:1;27;20:12;5:2;20642:655:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;14422:1193;;8:9:-1;5:2;;;30:1;27;20:12;5:2;14422:1193:1;;;;;;;;;;;;;;;;;;;937:77:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;937:77:15;;;;;;;;;;;;;;;;;;;;1288:92;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1288:92:15;;;;;;;;;;;;;;;;;;;;6166:186:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;6166:186:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;825:227:6;;8:9:-1;5:2;;;30:1;27;20:12;5:2;825:227:6;;;;;;;;;;;;;;;;;;;;7671:1186:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;7671:1186:1;;;;;;;;;;;;;;;;;;;21303:110;;8:9:-1;5:2;;;30:1;27;20:12;5:2;21303:110:1;;;;;;;;;;;;;;;;;;;18564:215;;8:9:-1;5:2;;;30:1;27;20:12;5:2;18564:215:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;499:116:6;;8:9:-1;5:2;;;30:1;27;20:12;5:2;499:116:6;;;;;;;;;;;;;;;;;;;19568:363:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;19568:363:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;1412:276:9;;8:9:-1;5:2;;;30:1;27;20:12;5:2;1412:276:9;;;;;;;;;;;;;;;;;;;18087:268:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;18087:268:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;5100:233;;8:9:-1;5:2;;;30:1;27;20:12;5:2;5100:233:1;;;;;;;;;;;;;;;;;;;18785:145;;8:9:-1;5:2;;;30:1;27;20:12;5:2;18785:145:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;2010:107:15;;8:9:-1;5:2;;;30:1;27;20:12;5:2;2010:107:15;;;;;;;;;;;;;;;;;;;23107:264:1;;8:9:-1;5:2;;;30:1;27;20:12;5:2;23107:264:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;22802:162;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;22882:21:1;22906:13;:11;:13::i;:::-;22882:37;;22929:8;:17;;;22947:3;22952:4;22929:28;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22929:28:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22929:28:1;;;;1197:1:15;22802:162:1;;:::o;1720:31::-;;;;;;;;;;;;;:::o;17576:113::-;17634:4;17657:25;17678:3;17657:8;:20;;:25;;;;:::i;:::-;17650:32;;17576:113;;;:::o;5339:138::-;5383:16;5417:53;2735:66;5456:13;;5417:8;:38;;:53;;;;:::i;:::-;5410:60;;5339:138;:::o;10801:280::-;10860:16;10878:18;10908:19;10938:37;10964:10;10938:8;:25;;:37;;;;:::i;:::-;10930:46;;;10908:68;;11015:11;11001:27;;10987:41;;11070:2;11057:11;:15;52:12:-1;49:1;45:20;29:14;25:41;7:59;;11057:15:1;11038:35;;10801:280;;;;:::o;4099:962::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;4612:1:1;4592:21;;:6;:16;4599:8;4592:16;;;;;;;;;;;;:21;4584:54;;;;;;;;;;;;;;;;;;;;;;;;4649:16;4676:3;4649:31;;4742:48;4759:8;4769:10;4781:8;4742:16;:48::i;:::-;4801:49;2735:66;4825:13;;4840:9;4801:8;:23;;:49;;;;;:::i;:::-;;4930:24;4945:8;4930:7;:14;;:24;;;;:::i;:::-;;4998:56;5009:9;5020:8;5030:10;5042:11;4998:10;:56::i;:::-;;1197:1:15;4099:962:1;;;;;:::o;23377:117::-;23423:7;23449:13;:11;:13::i;:::-;:23;;;23481:4;23449:38;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;23449:38:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;23449:38:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;23449:38:1;;;;;;;;;23442:45;;23377:117;:::o;8863:891::-;9032:8;6566:18;6586:16;6606:26;6623:8;6606:16;:26::i;:::-;6565:67;;;;6728:1;6715:10;:14;6707:58;;;;;;;;;;;;;;;;;;;;;;;;6857:1;6844:10;:14;:35;;;;6875:4;6862:17;;:9;:7;:9::i;:::-;:17;;;6844:35;:63;;;;6895:12;:10;:12::i;:::-;6883:24;;:8;:24;;;6844:63;6836:122;;;;;;;;;;;;;;;;;;;;;;;;9052:18;9073:25;9082:5;9089:8;9073;:25::i;:::-;9052:46;;9108:23;9134:30;9143:8;9153:10;9134:8;:30::i;:::-;9108:56;;9224:5;9183:46;;:37;9204:15;9183:8;:20;;:37;;;;:::i;:::-;:46;;;9175:82;;;;;;;;;;;;;;;;;;;;;;;;9297:20;:18;:20::i;:::-;9393:36;9416:8;9426:2;9393:7;:22;;:36;;;;;:::i;:::-;;9591:5;9555:41;;:32;9576:10;9555:8;:20;;:32;;;;:::i;:::-;:41;;;9551:109;;;9611:38;9624:10;9636:2;9640:8;9611:12;:38::i;:::-;9551:109;9702:45;9726:15;9743:3;9702:8;:23;;:45;;;;;:::i;:::-;;6969:1;;8863:891;;;;;;;;:::o;2695:106::-;2735:66;2695:106;;;:::o;3247:249::-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;3360:12:1;3340:8;;:33;;;;;;;;;;;;;;;;;;3383;3405:10;3383:21;:33::i;:::-;3426:40;3453:12;3426:26;:40::i;:::-;3476:13;:11;:13::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;3247:249:1;;;:::o;1616:45::-;;;;;;;;;;;;;;;;;:::o;17821:260::-;17890:7;17914:37;17935:15;17914:8;:20;;:37;;;;:::i;:::-;17910:165;;;17974:42;18000:15;17974:8;:25;;:42;;;;:::i;:::-;17967:49;;;;17910:165;18062:1;18054:10;;18047:17;;17821:260;;;;:::o;1724:137:15:-;1141:9;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;1822:1;1785:40;;1806:6;;;;;;;;;;;1785:40;;;;;;;;;;;;1852:1;1835:6;;:19;;;;;;;;;;;;;;;;;;1724:137::o;621:90:6:-;664:7;690:14;:12;:14::i;:::-;683:21;;621:90;:::o;5622:518:1:-;5803:4;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;5820:33:1;;:::i;:::-;5856:97;5885:9;5908:10;5932:11;5856:15;:97::i;:::-;5820:133;;5964:20;5987;:11;:18;:20::i;:::-;5964:43;;6091:42;6115:8;6125:7;6091:8;:23;;:42;;;;;:::i;:::-;6084:49;;;;5622:518;;;;;;:::o;12420:606::-;12581:18;12602:25;12611:5;12618:8;12602;:25::i;:::-;12581:46;;12637:23;12663:30;12672:8;12682:10;12663:8;:30::i;:::-;12637:56;;12704:44;12716:8;12726:5;12733:10;12745:2;12704:11;:44::i;:::-;12788:20;:18;:20::i;:::-;12851:54;12875:15;12900:3;12851:8;:23;;:54;;;;;:::i;:::-;;12997:3;12987:8;12977;12967:52;13002:2;13006:12;:10;:12::i;:::-;12967:52;;;;;;;;;;;;;;;;12420:606;;;;;;;:::o;945:210:9:-;1011:7;1052:12;:10;:12::i;:::-;1038:26;;:10;:26;;;1030:77;;;;;;;;;;;;;;;;;;;;;;;;1124:24;1140:7;;1124:24;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;1124:24:9;;;;;;:15;:24::i;:::-;1117:31;;945:210;;;;:::o;15894:357:1:-;16008:18;16029:25;16038:5;16045:8;16029;:25::i;:::-;16008:46;;16065:44;16077:8;16087:10;16099:5;16106:2;16065:11;:44::i;:::-;16149:20;:18;:20::i;:::-;16205:39;16231:8;16241:2;16205:7;:25;;:39;;;;;:::i;:::-;;15894:357;;;;:::o;20642:655::-;20962:7;20971:12;20996:21;21020:15;:13;:15::i;:::-;20996:39;;21105:18;21126:10;:25;21137:13;21126:25;;;;;;;;;;;;21105:46;;21180:17;;;;;;;;;;;21166:31;;:10;:31;;21162:89;;;21219:21;21238:1;21219:18;:21::i;:::-;21212:28;;;;;;;;21162:89;21269:21;:19;:21::i;:::-;21262:28;;;;;;20642:655;;;;;;;;;;;;;;;:::o;14422:1193::-;14563:18;14584:25;14593:5;14600:8;14584;:25::i;:::-;14563:46;;14619:23;14645:30;14654:8;14664:10;14645:8;:30::i;:::-;14619:56;;14686:44;14698:8;14708:10;14720:5;14727:2;14686:11;:44::i;:::-;14770:20;:18;:20::i;:::-;14827:12;14842:35;14861:15;14842:8;:18;;:35;;;;:::i;:::-;14827:50;;14907:4;14896:15;;:7;:15;;;14888:46;;;;;;;;;;;;;;;;;;;;;;;;14422:1193;;;;;;;:::o;937:77:15:-;975:7;1001:6;;;;;;;;;;;994:13;;937:77;:::o;1288:92::-;1328:4;1367:6;;;;;;;;;;;1351:22;;:12;:10;:12::i;:::-;:22;;;1344:29;;1288:92;:::o;6166:186:1:-;6221:21;;:::i;:::-;6254:20;6277:30;6301:5;6277:8;:23;;:30;;;;:::i;:::-;6254:53;;6324:21;:7;:19;:21::i;:::-;6317:28;;;6166:186;;;:::o;825:227:6:-;873:13;1031:14;;;;;;;;;;;;;;;;;;;;825:227;:::o;7671:1186:1:-;7833:8;6566:18;6586:16;6606:26;6623:8;6606:16;:26::i;:::-;6565:67;;;;6728:1;6715:10;:14;6707:58;;;;;;;;;;;;;;;;;;;;;;;;6857:1;6844:10;:14;:35;;;;6875:4;6862:17;;:9;:7;:9::i;:::-;:17;;;6844:35;:63;;;;6895:12;:10;:12::i;:::-;6883:24;;:8;:24;;;6844:63;6836:122;;;;;;;;;;;;;;;;;;;;;;;;7853:18;7874:25;7883:5;7890:8;7874;:25::i;:::-;7853:46;;7909:23;7935:30;7944:8;7954:10;7935:8;:30::i;:::-;7909:56;;8025:5;7984:46;;:37;8005:15;7984:8;:20;;:37;;;;:::i;:::-;:46;;;7976:82;;;;;;;;;;;;;;;;;;;;;;;;8098:20;:18;:20::i;:::-;8297:36;8320:8;8330:2;8297:7;:22;;:36;;;;;:::i;:::-;;8495:5;8459:41;;:32;8480:10;8459:8;:20;;:32;;;;:::i;:::-;:41;;;8455:109;;;8515:38;8528:10;8540:2;8544:8;8515:12;:38::i;:::-;8455:109;8681:54;8705:15;8730:3;8681:8;:23;;:54;;;;;:::i;:::-;;8827:3;8817:8;8807;8797:52;8832:2;8836:12;:10;:12::i;:::-;8797:52;;;;;;;;;;;;;;;;6969:1;;7671:1186;;;;;;;;:::o;21303:110::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;21402:3:1;21375:17;;:31;;;;;;;;;;;;;;;;;;21303:110;:::o;18564:215::-;18626:16;18695:4;18662:37;;:29;18682:8;18662:7;:19;;:29;;;;:::i;:::-;:37;;;18654:67;;;;;;;;;;;;;;;;;;;;;;;;18739:33;18763:8;18739:7;:23;;:33;;;;:::i;:::-;18732:40;;18564:215;;;:::o;499:116:6:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;570:38:6;595:12;570:24;:38::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;499:116:6;;:::o;19568:363:1:-;19658:18;19678:16;19738:1;19718:21;;:6;:17;19725:9;19718:17;;;;;;;;;;;;:21;19710:54;;;;;;;;;;;;;;;;;;;;;;;;19775:21;19807:6;:17;19814:9;19807:17;;;;;;;;;;;;19799:26;;;19775:50;;19863:13;19849:29;;19836:42;;19922:1;19907:13;:16;52:12:-1;49:1;45:20;29:14;25:41;7:59;;19907:16:1;19888:36;;19568:363;;;;:::o;1412:276:9:-;1557:12;:10;:12::i;:::-;1543:26;;:10;:26;;;1535:77;;;;;;;;;;;;;;;;;;;;;;;;1622:59;1639:7;;1622:59;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;1622:59:9;;;;;;1648:7;1657:12;1671:9;1622:16;:59::i;:::-;1412:276;;;;;:::o;18087:268:1:-;18159:12;18188:37;18209:15;18188:8;:20;;:37;;;;:::i;:::-;18184:165;;;18248:40;18272:15;18248:8;:23;;:40;;;;:::i;:::-;18241:47;;;;18184:165;18336:1;18326:12;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;18326:12:1;;;;18319:19;;18087:268;;;;:::o;5100:233::-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;5226:1:1;5207:20;;:6;:16;5214:8;5207:16;;;;;;;;;;;:20;;;;5237:52;2735:66;5264:13;;5279:9;5237:8;:26;;:52;;;;;:::i;:::-;;5299:27;5317:8;5299:7;:17;;:27;;;;:::i;:::-;;5100:233;;:::o;18785:145::-;18859:4;18882:41;18910:8;18920:2;18882:7;:27;;:41;;;;;:::i;:::-;18875:48;;18785:145;;;;:::o;2010:107:15:-;1141:9;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;2082:28;2101:8;2082:18;:28::i;:::-;2010:107;:::o;23107:264:1:-;23176:7;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;23195:21:1;23219:13;:11;:13::i;:::-;23195:37;;23242:15;23260:13;:11;:13::i;:::-;:23;;;23292:4;23260:38;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;23260:38:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;23260:38:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;23260:38:1;;;;;;;;;23242:56;;23308:8;:17;;;23326:7;23335:4;23308:32;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;23308:32:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;23308:32:1;;;;23357:7;23350:14;;;;23107:264;;;:::o;23500:112::-;23546:12;23590:14;:12;:14::i;:::-;23570:35;;23500:112;:::o;5682:394:24:-;5806:4;5845:42;5882:4;5845:10;:24;;:36;;:42;;;;:::i;:::-;:103;;;;5903:45;5943:4;5903:10;:27;;:39;;:45;;;;:::i;:::-;5845:103;:162;;;;5964:43;6002:4;5964:10;:25;;:37;;:43;;;;:::i;:::-;5845:162;:224;;;;6023:46;6064:4;6023:10;:28;;:40;;:46;;;;:::i;:::-;5845:224;5826:243;;5682:394;;;;:::o;4706:229::-;4846:16;4881:47;4923:4;4881:10;:25;;:41;;:47;;;;:::i;:::-;4874:54;;4706:229;;;;:::o;9510:203::-;9636:7;9662:44;9702:3;9662:10;:24;;:39;;:44;;;;:::i;:::-;9655:51;;9510:203;;;;:::o;20036:275:1:-;1141:9:15;:7;:9::i;:::-;1133:54;;;;;;;;;;;;;;;;;;;;;;;;20145:21:1;20194:10;20177:27;;;;;;20250:1;20239:8;20231:20;;;;;;20214:37;;;;;;20290:13;20282:22;;20262:6;:17;20269:9;20262:17;;;;;;;;;;;:42;;;;1197:1:15;20036:275:1;;;:::o;20565:632:24:-;20709:4;20747:42;20784:4;20747:10;:24;;:36;;:42;;;;:::i;:::-;20746:43;20725:122;;;;;;;;;;;;;;;;;;;;;;;;20879:45;20919:4;20879:10;:27;;:39;;:45;;;;:::i;:::-;20878:46;20857:125;;;;;;;;;;;;;;;;;;;;;;;;21014:46;21055:4;21014:10;:28;;:40;;:46;;;;:::i;:::-;21013:47;20992:126;;;;;;;;;;;;;;;;;;;;;;;;21136:54;21177:4;21183:6;21136:10;:25;;:40;;:54;;;;;:::i;:::-;21129:61;;20565:632;;;;;:::o;818:168:19:-;925:4;952:27;975:3;952:13;:18;;:22;;:27;;;;:::i;:::-;945:34;;818:168;;;;:::o;2244:207:5:-;2289:7;2326:14;:12;:14::i;:::-;2312:28;;:10;:28;;;;2308:137;;;2363:10;2356:17;;;;2308:137;2411:23;:21;:23::i;:::-;2404:30;;2244:207;;:::o;19145:317:1:-;19216:7;19235:19;19267:2;19257:13;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;19257:13:1;;;;19235:35;;19328:6;19323:2;19315:6;19311:15;19304:31;19372:4;19367:2;19359:6;19355:15;19348:29;19397:14;19424:6;19414:17;;;;;;19397:34;;19449:6;19442:13;;;;19145:317;;;;:::o;21592:282::-;21642:21;21666:15;:13;:15::i;:::-;21642:39;;21692:18;21713:10;:25;21724:13;21713:25;;;;;;;;;;;;21692:46;;21790:1;21777:10;:14;21749:10;:25;21760:13;21749:25;;;;;;;;;;;:42;;;;21592:282;;:::o;2339:312:19:-;2483:4;2503:31;2515:13;2530:3;2503:11;:31::i;:::-;2499:146;;;2557:34;2585:5;2557:13;:18;;:23;2576:3;2557:23;;;;;;;;;;;:27;;:34;;;;:::i;:::-;2550:41;;;;2499:146;2629:5;2622:12;;2339:312;;;;;;:::o;9885:686:1:-;10021:5;9985:41;;:32;10006:10;9985:8;:20;;:32;;;;:::i;:::-;:41;;;9977:75;;;;;;;;;;;;;;;;;;;;;;;;10063:19;10093:11;10107:8;;;;;;;;;;;:16;;;10124:3;10107:21;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;10107:21:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;10107:21:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;10107:21:1;;;;;;;;;10093:35;;10138:11;10152:8;;;;;;;;;;;:17;;;10170:3;10152:22;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;10152:22:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;10152:22:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;10152:22:1;;;;;;;;;10138:36;;10184:9;10196:8;;;;;;;;;;;:15;;;10212:3;10196:20;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;10196:20:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;10196:20:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;10196:20:1;;;;;;;;;10184:32;;10242:4;10227:19;;;;;;10287:2;10279:5;10271:14;;:18;;;;10256:33;;;;10328:2;10322:3;10314:12;;:16;;;;10299:31;;;;10341:18;10376:11;10362:27;;10341:48;;10438:2;10423:12;:10;:12::i;:::-;10415:21;;:25;;;;10400:40;;;;10451:57;10475:10;10495:11;10487:20;;10451:8;:23;;:57;;;;;:::i;:::-;;9885:686;;;;;;;;:::o;19584:637:24:-;19733:4;19771:42;19808:4;19771:10;:24;;:36;;:42;;;;:::i;:::-;19770:43;19749:122;;;;;;;;;;;;;;;;;;;;;;;;19903:43;19941:4;19903:10;:25;;:37;;:43;;;;:::i;:::-;19902:44;19881:123;;;;;;;;;;;;;;;;;;;;;;;;20036:46;20077:4;20036:10;:28;;:40;;:46;;;;:::i;:::-;20035:47;20014:126;;;;;;;;;;;;;;;;;;;;;;;;20158:56;20201:4;20207:6;20158:10;:27;;:42;;:56;;;;;:::i;:::-;20151:63;;19584:637;;;;;:::o;1488:536:14:-;1535:4;1900:12;1923:4;1900:28;;1938:10;1987:4;1975:17;1969:23;;2016:1;2010:2;:7;2003:14;;;;1488:536;:::o;719:142:15:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;793:6:15;784;;:15;;;;;;;;;;;;;;;;;;847:6;;;;;;;;;;;814:40;;843:1;814:40;;;;;;;;;;;;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;719:142:15;;:::o;3502:279:1:-;3564:4;3544:17;;:24;;;;;;;;;;;;;;;;;;3688:86;2735:66;3704:13;;3719:54;3688:8;:15;;:86;;;;;:::i;:::-;;3502:279::o;1173:248:5:-;1220:16;1248:12;754:66;1263:30;;1248:45;;1400:4;1394:11;1382:23;;1368:47;;:::o;1327:396:29:-;1472:12;;:::i;:::-;1526;:19;1504:11;:18;:41;1496:70;;;;;;;;;;;;;;;;;;;;;;;;1576:18;;:::i;:::-;1617:5;1604;:10;;:18;;;;;1648:46;1669:11;1681:12;1648:20;:46::i;:::-;1632:5;:13;;:62;;;;1711:5;1704:12;;;1327:396;;;;;:::o;1780:424::-;1839:12;1863:14;1880:11;1885:5;1880:4;:11::i;:::-;1863:28;;1901:17;1931:6;1921:17;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;1921:17:29;;;;1901:37;;1963:38;1988:6;1996:4;1963:5;:10;;;:24;;:38;;;;;:::i;:::-;2054:2;2044:12;;;;2075:38;2100:6;2108:4;2075:5;:13;;;:24;;:38;;;;;:::i;:::-;2066:47;;2142:1;2132:6;:11;2124:52;;;;;;;;;;;;;;;;;;;;;;;;2193:4;2186:11;;;;1780:424;;;:::o;11087:1327:1:-;11246:4;11201:49;;:41;11229:8;11239:2;11201:7;:27;;:41;;;;;:::i;:::-;:49;;;11193:90;;;;;;;;;;;;;;;;;;;;;;;;11295:18;11315:16;11335:26;11352:8;11335:16;:26::i;:::-;11294:67;;;;11457:1;11444:10;:14;11436:53;;;;;;;;;;;;;;;;;;;;;;;;11581:1;11568:10;:14;:35;;;;11599:4;11586:17;;:9;:7;:9::i;:::-;:17;;;11568:35;:63;;;;11619:12;:10;:12::i;:::-;11607:24;;:8;:24;;;11568:63;11560:122;;;;;;;;;;;;;;;;;;;;;;;;11870:1;11856:10;:15;;11852:556;;;11969:19;11991:37;12017:10;11991:8;:25;;:37;;;;:::i;:::-;11969:59;;12042:16;12091:2;12077:11;12069:20;;;:24;52:12:-1;49:1;45:20;29:14;25:41;7:59;;12069:24:1;12042:52;;12192:12;:10;:12::i;:::-;12180:24;;:8;:24;;;12176:222;;;;;;12289:4;12276:17;;:9;:7;:9::i;:::-;:17;;;:45;;;;12309:12;:10;:12::i;:::-;12297:24;;:8;:24;;;12276:45;12268:115;;;;;;;;;;;;;;;;;;;;;;;;12176:222;11852:556;;;11087:1327;;;;;;:::o;16647:632:24:-;16791:4;16829:45;16869:4;16829:10;:27;;:39;;:45;;;;:::i;:::-;16828:46;16807:125;;;;;;;;;;;;;;;;;;;;;;;;16964:43;17002:4;16964:10;:25;;:37;;:43;;;;:::i;:::-;16963:44;16942:123;;;;;;;;;;;;;;;;;;;;;;;;17097:46;17138:4;17097:10;:28;;:40;;:46;;;;:::i;:::-;17096:47;17075:126;;;;;;;;;;;;;;;;;;;;;;;;17219:53;17259:4;17265:6;17219:10;:24;;:39;;:53;;;;;:::i;:::-;17212:60;;16647:632;;;;;:::o;22410:81:1:-;22475:7;22410:81;;;:::o;13032:1221::-;13191:4;13146:49;;:41;13174:8;13184:2;13146:7;:27;;:41;;;;;:::i;:::-;:49;;;13138:78;;;;;;;;;;;;;;;;;;;;;;;;13228:18;13248:16;13268:26;13285:8;13268:16;:26::i;:::-;13227:67;;;;13390:1;13377:10;:14;13369:58;;;;;;;;;;;;;;;;;;;;;;;;13519:1;13506:10;:14;:35;;;;13537:4;13524:17;;:9;:7;:9::i;:::-;:17;;;13506:35;:63;;;;13557:12;:10;:12::i;:::-;13545:24;;:8;:24;;;13506:63;13498:122;;;;;;;;;;;;;;;;;;;;;;;;13808:1;13794:10;:15;;13790:457;;;13829:9;:7;:9::i;:::-;:37;;;;13854:12;:10;:12::i;:::-;13842:24;;:8;:24;;;13829:37;13825:412;;;;;;14015:19;14037:37;14063:10;14037:8;:25;;:37;;;;:::i;:::-;14015:59;;14092:16;14141:2;14127:11;14119:20;;;:24;52:12:-1;49:1;45:20;29:14;25:41;7:59;;14119:24:1;14092:52;;14182:12;:10;:12::i;:::-;14170:24;;:8;:24;;;14162:60;;;;;;;;;;;;;;;;;;;;;;;;13825:412;;;13790:457;13032:1221;;;;;;:::o;3131:318:19:-;3278:4;3298:31;3310:13;3325:3;3298:11;:31::i;:::-;3294:149;;;3352:37;3383:5;3352:13;:18;;:23;3371:3;3352:23;;;;;;;;;;;:30;;:37;;;;:::i;:::-;3345:44;;;;3294:149;3427:5;3420:12;;3131:318;;;;;;:::o;21902:403:1:-;21950:21;21984:15;22010:11;22024:8;;;;;;;;;;;:16;;;22041:3;22024:21;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22024:21:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22024:21:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;22024:21:1;;;;;;;;;22010:35;;22055:11;22069:8;;;;;;;;;;;:17;;;22087:3;22069:22;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22069:22:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22069:22:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;22069:22:1;;;;;;;;;22055:36;;22101:9;22113:8;;;;;;;;;;;:15;;;22129:3;22113:20;;;;;;;;;;;;;;;;;;;;;;;;;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;22113:20:1;;;;8:9:-1;5:2;;;45:16;42:1;39;24:38;77:16;74:1;67:27;5:2;22113:20:1;;;;;;;101:4:-1;97:9;90:4;84;80:15;76:31;69:5;65:43;126:6;120:4;113:20;0:138;22113:20:1;;;;;;;;;22101:32;;22155:4;22144:15;;;;;;22196:2;22188:5;22180:14;;:18;;;;22169:29;;;;22233:2;22227:3;22219:12;;:16;;;;22208:27;;;;22289:7;22272:25;;;;;;;;;;;;;;;49:4:-1;39:7;30;26:21;22:32;13:7;6:49;22272:25:1;;;22262:36;;;;;;22246:52;;21902:403;;;;;:::o;2441:156:9:-;2511:7;2520:12;2576:9;427:2;2552:33;2544:46;;;;;;;;;;;;;;;;;2441:156;;;:::o;1869:124::-;1923:7;1932:12;1963:23;;;;;;;;;;;;;;:19;:23::i;:::-;1956:30;;;;1869:124;;:::o;26241:371:24:-;26350:4;26389:40;26424:4;26389:10;:24;;:34;;:40;;;;:::i;:::-;:99;;;;26445:43;26483:4;26445:10;:27;;:37;;:43;;;;:::i;:::-;26389:99;:156;;;;26504:41;26540:4;26504:10;:25;;:35;;:41;;;;:::i;:::-;26389:156;:216;;;;26561:44;26600:4;26561:10;:28;;:38;;:44;;;;:::i;:::-;26389:216;26370:235;;26241:371;;;;:::o;11579:209::-;11703:12;11734:47;11777:3;11734:10;:27;;:42;;:47;;;;:::i;:::-;11727:54;;11579:209;;;;:::o;2286:403:29:-;2375:12;;:::i;:::-;2403:14;2420:6;:13;2403:30;;2443:18;;:::i;:::-;2484:24;2501:6;2484;:16;;:24;;;;:::i;:::-;2471:5;:10;;:37;;;;;2528:2;2518:12;;;;2566:31;2590:6;2566;:23;;:31;;;;:::i;:::-;2540:57;;;2541:5;:13;;2540:57;;;;;;;;2626:1;2616:6;:11;2608:52;;;;;;;;;;;;;;;;;;;;;;;;2677:5;2670:12;;;;2286:403;;;:::o;992:185:19:-;1115:4;1138:32;1166:3;1138:13;:18;;:27;;:32;;;;:::i;:::-;1131:39;;992:185;;;;:::o;4160:319::-;4287:16;4319:31;4331:13;4346:3;4319:11;:31::i;:::-;4315:158;;;4373:35;:13;:18;;:23;4392:3;4373:23;;;;;;;;;;;:33;:35::i;:::-;4366:42;;;;4315:158;4460:1;4446:16;;;;;;;;;;;;;;;;;;;;;;29:2:-1;21:6;17:15;117:4;105:10;97:6;88:34;148:4;140:6;136:17;126:27;;0:157;4446:16:19;;;;4439:23;;4160:319;;;;;:::o;913:254:5:-;1055:12:14;;;;;;;;;;;:31;;;;1071:15;:13;:15::i;:::-;1055:31;:47;;;;1091:11;;;;;;;;;;;1090:12;1055:47;1047:106;;;;;;;;;;;;;;;;;;;;;;;;1164:19;1187:12;;;;;;;;;;;1186:13;1164:35;;1213:14;1209:96;;;1258:4;1243:12;;:19;;;;;;;;;;;;;;;;;;1290:4;1276:11;;:18;;;;;;;;;;;;;;;;;;1209:96;1130:30:5;1147:12;1130:16;:30::i;:::-;1331:14:14;1327:65;;;1376:5;1361:12;;:20;;;;;;;;;;;;;;;;;;1327:65;913:254:5;;:::o;22497:101:1:-;;;;;:::o;26876:234:24:-;27023:4;27046:57;27090:4;27096:6;27046:10;:25;;:43;;:57;;;;;:::i;:::-;27039:64;;26876:234;;;;;:::o;2657:324:19:-;2767:4;2791:31;2803:13;2818:3;2791:11;:31::i;:::-;2787:188;;;2891:30;2917:3;2891:13;:18;;:25;;:30;;;;:::i;:::-;2884:37;;;;2787:188;2959:5;2952:12;;2657:324;;;;;:::o;3540:327::-;3694:4;3714:31;3726:13;3741:3;3714:11;:31::i;:::-;3710:151;;;3768:39;3801:5;3768:13;:18;;:23;3787:3;3768:23;;;;;;;;;;;:32;;:39;;;;:::i;:::-;3761:46;;;;3710:151;3845:5;3838:12;;3540:327;;;;;;:::o;2218:225:15:-;2311:1;2291:22;;:8;:22;;;;2283:73;;;;;;;;;;;;;;;;;;;;;;;;2400:8;2371:38;;2392:6;;;;;;;;;;;2371:38;;;;;;;;;;;;2428:8;2419:6;;:17;;;;;;;;;;;;;;;;;;2218:225;:::o;897:190:18:-;1021:4;1044:36;1076:3;1044:17;:22;;:31;;:36;;;;:::i;:::-;1037:43;;897:190;;;;:::o;803::21:-;925:4;952:34;982:3;952:15;:20;;:29;;:34;;;;:::i;:::-;945:41;;803:190;;;;:::o;1212:189:22:-;1335:4;1362:32;1390:3;1362:13;:18;;:27;;:32;;;;:::i;:::-;1355:39;;1212:189;;;;:::o;3034:265:18:-;3161:7;3188:35;3200:17;3219:3;3188:11;:35::i;:::-;3180:67;;;;;;;;;;;;;;;;;;;;;;;;3265:17;:22;;:27;3288:3;3265:27;;;;;;;;;;;;3258:34;;3034:265;;;;:::o;1036:273:20:-;1122:4;1147:20;1156:3;1161:5;1147:8;:20::i;:::-;1146:21;1142:161;;;1202:3;:10;;1218:5;1202:22;;39:1:-1;33:3;27:10;23:18;57:10;52:3;45:23;79:10;72:17;;0:93;1202:22:20;;;;;;;;;;;;;;;;;;;;;1183:3;:9;;:16;1193:5;1183:16;;;;;;;;;;;:41;;;;1245:4;1238:11;;;;1142:161;1287:5;1280:12;;1036:273;;;;;:::o;2669:1238:5:-;2724:14;3523:18;3544:8;;3523:29;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;30:3:-1;22:6;14;1:33;99:1;93:3;85:6;81:16;74:27;137:4;133:9;126:4;121:3;117:14;113:30;106:37;;169:3;161:6;157:16;147:26;;3523:29:5;;;;;;;;3562:13;3578:8;;:15;;3562:31;;3825:42;3816:5;3809;3805:17;3799:24;3795:73;3785:83;;3894:6;3887:13;;;;2669:1238;:::o;2162:248:21:-;2308:4;2352:5;2324:15;:20;;:25;2345:3;2324:25;;;;;;;;;;;:33;;;;;;;;;;;;:::i;:::-;;2374:29;2399:3;2374:15;:20;;:24;;:29;;;;:::i;:::-;2367:36;;2162:248;;;;;:::o;24588:1438:24:-;24730:4;24769:1;24760:5;24754:12;;;;;;;;:16;;;24746:48;;;;;;;;;;;;;;;;;;;;;;;;24826:42;24863:4;24826:10;:24;;:36;;:42;;;;:::i;:::-;24825:43;24804:122;;;;;;;;;;;;;;;;;;;;;;;;24958:45;24998:4;24958:10;:27;;:39;;:45;;;;:::i;:::-;24957:46;24936:125;;;;;;;;;;;;;;;;;;;;;;;;25093:43;25131:4;25093:10;:25;;:37;;:43;;;;:::i;:::-;25092:44;25071:123;;;;;;;;;;;;;;;;;;;;;;;;25226:46;25267:4;25226:10;:28;;:40;;:46;;;;:::i;:::-;25225:47;25204:126;;;;;;;;;;;;;;;;;;;;;;;;25378:5;25345:38;;;;;;;;:29;:38;;;;;;;;;25341:114;;;25406:38;25439:4;25406:10;:25;;:32;;:38;;;;:::i;:::-;25399:45;;;;25341:114;25504:5;25468:41;;;;;;;;:32;:41;;;;;;;;;25464:120;;;25532:41;25568:4;25532:10;:28;;:35;;:41;;;;:::i;:::-;25525:48;;;;25464:120;25629:5;25597:37;;;;;;;;:28;:37;;;;;;;;;25593:262;;;25673:171;25734:4;25760:66;25673:171;;:10;:24;;:39;;:171;;;;;:::i;:::-;25650:194;;;;25593:262;25903:5;25868:40;;;;;;;;:31;:40;;;;;;;;;25864:156;;;25947:62;25990:4;26006:1;25996:12;;;;;;;;;;;;;;;;;;;;;;;;;29:1:-1;21:6;17:14;116:4;104:10;96:6;87:34;147:4;139:6;135:17;125:27;;0:156;25996:12:24;;;;25947:10;:27;;:42;;:62;;;;;:::i;:::-;25924:85;;;;25864:156;24588:1438;;;;;;:::o;1083:535:28:-;1209:15;1266:12;:19;1244:11;:18;:41;1236:70;;;;;;;;;;;;;;;;;;;;;;;;1317:23;1356:11;:18;1343:32;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;;;;;;;;;;;;;;;1317:58;;1390:9;1402:1;1390:13;;1385:202;1409:11;:18;1405:1;:22;1385:202;;;1448:17;;:::i;:::-;1490:11;1502:1;1490:14;;;;;;;;;;;;;;;;;;1479:3;:8;;:25;;;;;1531:12;1544:1;1531:15;;;;;;;;;;;;;;;;;;1518:3;:10;;:28;;;;;1573:3;1560:7;1568:1;1560:10;;;;;;;;;;;;;;;;;:16;;;;1385:202;1429:3;;;;;;;1385:202;;;;1604:7;1597:14;;;1083:535;;;;:::o;666:166:29:-;738:7;776:21;:6;:14;;;:19;:21::i;:::-;771:2;532;764:9;:33;757:40;;666:166;;;:::o;686:174:27:-;837:6;828;819:7;815:20;808:36;794:60;;;:::o;3133:509:28:-;3241:7;3260:14;3277:11;3260:28;;3321:35;3343:6;3351:4;3321:13;3326:7;3321:4;:13::i;:::-;:21;;:35;;;;;:::i;:::-;3376:2;3366:12;;;;3393:9;3405:1;3393:13;;3388:224;3412:7;:14;3408:1;:18;3388:224;;;3447:43;3477:6;3485:4;3447:7;3455:1;3447:10;;;;;;;;;;;;;;;;;;:15;;;:29;;:43;;;;;:::i;:::-;3514:2;3504:12;;;;3530:45;3562:6;3570:4;3530:7;3538:1;3530:10;;;;;;;;;;;;;;;;;;:17;;;:31;;:45;;;;;:::i;:::-;3599:2;3589:12;;;;3428:3;;;;;;;3388:224;;;;3629:6;3622:13;;;3133:509;;;;;:::o;2284:251:18:-;2429:4;2475:5;2445:17;:22;;:27;2468:3;2445:27;;;;;;;;;;;:35;;;;2497:31;2524:3;2497:17;:22;;:26;;:31;;;;:::i;:::-;2490:38;;2284:251;;;;;:::o;1439:1020:20:-;1528:4;1552:20;1561:3;1566:5;1552:8;:20::i;:::-;1548:905;;;1588:21;1631:1;1612:3;:9;;:16;1622:5;1612:16;;;;;;;;;;;;:20;1588:44;;1646:17;1686:1;1666:3;:10;;:17;;;;:21;1646:41;;1824:13;1811:9;:26;;1807:382;;;1857:17;1877:3;:10;;1888:9;1877:21;;;;;;;;;;;;;;;;;;1857:41;;2024:9;1996:3;:10;;2007:13;1996:25;;;;;;;;;;;;;;;;;:37;;;;2146:1;2130:13;:17;2107:3;:9;;:20;2117:9;2107:20;;;;;;;;;;;:40;;;;1807:382;;2270:3;:9;;:16;2280:5;2270:16;;;;;;;;;;;2263:23;;;2357:3;:10;;:16;;;;;;;;;;;;;;;;;;;;;;;;;;2395:4;2388:11;;;;;;1548:905;2437:5;2430:12;;1439:1020;;;;;:::o;2157:153:9:-;2231:7;2240:12;371:1;2295:7;2264:39;;;;2157:153;;;:::o;2693:335:18:-;2804:4;2828:35;2840:17;2859:3;2828:11;:35::i;:::-;2824:198;;;2886:17;:22;;:27;2909:3;2886:27;;;;;;;;;;;2879:34;;;2934;2964:3;2934:17;:22;;:29;;:34;;;;:::i;:::-;2927:41;;;;2824:198;3006:5;2999:12;;2693:335;;;;;:::o;2564:325:21:-;2671:4;2695:33;2707:15;2724:3;2695:11;:33::i;:::-;2691:192;;;2751:15;:20;;:25;2772:3;2751:25;;;;;;;;;;;;2744:32;;;;:::i;:::-;2797;2825:3;2797:15;:20;;:27;;:32;;;;:::i;:::-;2790:39;;;;2691:192;2867:5;2860:12;;2564:325;;;;;:::o;2878:322:22:-;2986:4;3010:31;3022:13;3037:3;3010:11;:31::i;:::-;3006:188;;;3110:30;3136:3;3110:13;:18;;:25;;:30;;;;:::i;:::-;3103:37;;;;3006:188;3178:5;3171:12;;2878:322;;;;;:::o;2895:262:21:-;3018:12;3050:33;3062:15;3079:3;3050:11;:33::i;:::-;3042:65;;;;;;;;;;;;;;;;;;;;;;;;3125:15;:20;;:25;3146:3;3125:25;;;;;;;;;;;3118:32;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;2895:262;;;;:::o;4371:349:25:-;4474:15;4557:6;4549;4545:19;4539:26;4528:37;;4514:200;;;;:::o;5339:641:28:-;5430:15;5447:7;5466:14;5483:11;5466:28;;5504:16;5523:24;5540:6;5523;:16;;:24;;;;:::i;:::-;5504:43;;5567:2;5557:12;;;;5580:11;377:2;5594:8;:15;;;;;;;;5580:29;;5619:22;5657:3;5644:17;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;;;;;;;;;;;;;;;5619:42;;5676:9;5688:1;5676:13;;5671:269;5695:3;5691:1;:7;5671:269;;;5719:20;;:::i;:::-;5767:24;5784:6;5767;:16;;:24;;;;:::i;:::-;5753:6;:11;;:38;;;;;5815:2;5805:12;;;;5847:24;5864:6;5847;:16;;:24;;;;:::i;:::-;5831:6;:13;;:40;;;;;5895:2;5885:12;;;;5923:6;5911;5918:1;5911:9;;;;;;;;;;;;;;;;;:18;;;;5671:269;5700:3;;;;;;;5671:269;;;;5958:6;5966;5950:23;;;;;;;;5339:641;;;;;:::o;2540:159:20:-;2644:4;2691:1;2671:3;:9;;:16;2681:5;2671:16;;;;;;;;;;;;:21;;2664:28;;2540:159;;;;:::o;3052:313::-;3142:16;3174:23;3214:3;:10;;:17;;;;3200:32;;;;;;;;;;;;;;;;;;;;;;29:2:-1;21:6;17:15;117:4;105:10;97:6;88:34;148:4;140:6;136:17;126:27;;0:157;3200:32:20;;;;3174:58;;3247:9;3242:94;3262:3;:10;;:17;;;;3258:1;:21;3242:94;;;3312:3;:10;;3323:1;3312:13;;;;;;;;;;;;;;;;;;3300:6;3307:1;3300:9;;;;;;;;;;;;;;;;;:25;;;;;3281:3;;;;;;;3242:94;;;;3352:6;3345:13;;;3052:313;;;:::o;1427:541:5:-;1493:23;1519:14;:12;:14::i;:::-;1493:40;;1574:1;1551:25;;:11;:25;;;;1543:82;;;;;;;;;;;;;;;;;;;;;;;;1658:15;1643:30;;:11;:30;;;;1635:86;;;;;;;;;;;;;;;;;;;;;;;;1770:11;1737:45;;1753:15;1737:45;;;;;;;;;;;;1793:12;754:66;1808:30;;1793:45;;1940:11;1934:4;1927:25;1913:49;;;:::o;1040:166:22:-;1145:4;1172:27;1195:3;1172:13;:18;;:22;;:27;;;;:::i;:::-;1165:34;;1040:166;;;;:::o;511:130:28:-;587:7;377:2;613:7;:14;:21;606:28;;511:130;;;:::o;2013:165:27:-;2155:6;2146;2137:7;2133:20;2126:36;2112:60;;;:::o;18218:210:25:-;18321:15;18404:6;18396;18392:19;18386:26;18375:37;;18361:61;;;;:::o;862:22752:1:-;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:::i;:::-;;;:::o;:::-;;;;;;;;;;;;;;;;;;;;;;;;;;;:::o;5:118:-1:-;;72:46;110:6;97:20;72:46;;;63:55;;57:66;;;;;130:134;;205:54;251:6;238:20;205:54;;;196:63;;190:74;;;;;289:707;;406:3;399:4;391:6;387:17;383:27;376:35;373:2;;;424:1;421;414:12;373:2;461:6;448:20;483:80;498:64;555:6;498:64;;;483:80;;;474:89;;580:5;605:6;598:5;591:21;635:4;627:6;623:17;613:27;;657:4;652:3;648:14;641:21;;710:6;757:3;749:4;741:6;737:17;732:3;728:27;725:36;722:2;;;774:1;771;764:12;722:2;799:1;784:206;809:6;806:1;803:13;784:206;;;867:3;889:37;922:3;910:10;889:37;;;884:3;877:50;950:4;945:3;941:14;934:21;;978:4;973:3;969:14;962:21;;841:149;831:1;828;824:9;819:14;;784:206;;;788:14;366:630;;;;;;;;1004:112;;1068:43;1103:6;1090:20;1068:43;;;1059:52;;1053:63;;;;;1123:118;;1190:46;1228:6;1215:20;1190:46;;;1181:55;;1175:66;;;;;1262:335;;;1376:3;1369:4;1361:6;1357:17;1353:27;1346:35;1343:2;;;1394:1;1391;1384:12;1343:2;1427:6;1414:20;1404:30;;1454:18;1446:6;1443:30;1440:2;;;1486:1;1483;1476:12;1440:2;1520:4;1512:6;1508:17;1496:29;;1570:3;1563;1555:6;1551:16;1541:8;1537:31;1534:40;1531:2;;;1587:1;1584;1577:12;1531:2;1336:261;;;;;;1606:440;;1707:3;1700:4;1692:6;1688:17;1684:27;1677:35;1674:2;;;1725:1;1722;1715:12;1674:2;1762:6;1749:20;1784:64;1799:48;1840:6;1799:48;;;1784:64;;;1775:73;;1868:6;1861:5;1854:21;1904:4;1896:6;1892:17;1937:4;1930:5;1926:16;1972:3;1963:6;1958:3;1954:16;1951:25;1948:2;;;1989:1;1986;1979:12;1948:2;1999:41;2033:6;2028:3;2023;1999:41;;;1667:379;;;;;;;;2054:120;;2131:38;2161:6;2155:13;2131:38;;;2122:47;;2116:58;;;;;2181:118;;2248:46;2286:6;2273:20;2248:46;;;2239:55;;2233:66;;;;;2306:122;;2384:39;2415:6;2409:13;2384:39;;;2375:48;;2369:59;;;;;2435:114;;2500:44;2536:6;2523:20;2500:44;;;2491:53;;2485:64;;;;;2556:118;;2632:37;2661:6;2655:13;2632:37;;;2623:46;;2617:57;;;;;2681:241;;2785:2;2773:9;2764:7;2760:23;2756:32;2753:2;;;2801:1;2798;2791:12;2753:2;2836:1;2853:53;2898:7;2889:6;2878:9;2874:22;2853:53;;;2843:63;;2815:97;2747:175;;;;;2929:257;;3041:2;3029:9;3020:7;3016:23;3012:32;3009:2;;;3057:1;3054;3047:12;3009:2;3092:1;3109:61;3162:7;3153:6;3142:9;3138:22;3109:61;;;3099:71;;3071:105;3003:183;;;;;3193:366;;;3314:2;3302:9;3293:7;3289:23;3285:32;3282:2;;;3330:1;3327;3320:12;3282:2;3365:1;3382:53;3427:7;3418:6;3407:9;3403:22;3382:53;;;3372:63;;3344:97;3472:2;3490:53;3535:7;3526:6;3515:9;3511:22;3490:53;;;3480:63;;3451:98;3276:283;;;;;;3566:1497;;;;;;;;;;;;3845:3;3833:9;3824:7;3820:23;3816:33;3813:2;;;3862:1;3859;3852:12;3813:2;3897:1;3914:53;3959:7;3950:6;3939:9;3935:22;3914:53;;;3904:63;;3876:97;4004:2;4022:53;4067:7;4058:6;4047:9;4043:22;4022:53;;;4012:63;;3983:98;4140:2;4129:9;4125:18;4112:32;4164:18;4156:6;4153:30;4150:2;;;4196:1;4193;4186:12;4150:2;4224:64;4280:7;4271:6;4260:9;4256:22;4224:64;;;4206:82;;;;4091:203;4325:2;4343:53;4388:7;4379:6;4368:9;4364:22;4343:53;;;4333:63;;4304:98;4433:3;4452:53;4497:7;4488:6;4477:9;4473:22;4452:53;;;4442:63;;4412:99;4542:3;4561:53;4606:7;4597:6;4586:9;4582:22;4561:53;;;4551:63;;4521:99;4651:3;4670:53;4715:7;4706:6;4695:9;4691:22;4670:53;;;4660:63;;4630:99;4788:3;4777:9;4773:19;4760:33;4813:18;4805:6;4802:30;4799:2;;;4845:1;4842;4835:12;4799:2;4873:64;4929:7;4920:6;4909:9;4905:22;4873:64;;;4855:82;;;;4739:204;4974:3;4994:53;5039:7;5030:6;5019:9;5015:22;4994:53;;;4983:64;;4953:100;3807:1256;;;;;;;;;;;;;;;5070:241;;5174:2;5162:9;5153:7;5149:23;5145:32;5142:2;;;5190:1;5187;5180:12;5142:2;5225:1;5242:53;5287:7;5278:6;5267:9;5263:22;5242:53;;;5232:63;;5204:97;5136:175;;;;;5318:366;;;5439:2;5427:9;5418:7;5414:23;5410:32;5407:2;;;5455:1;5452;5445:12;5407:2;5490:1;5507:53;5552:7;5543:6;5532:9;5528:22;5507:53;;;5497:63;;5469:97;5597:2;5615:53;5660:7;5651:6;5640:9;5636:22;5615:53;;;5605:63;;5576:98;5401:283;;;;;;5691:889;;;;;5896:3;5884:9;5875:7;5871:23;5867:33;5864:2;;;5913:1;5910;5903:12;5864:2;5948:1;5965:53;6010:7;6001:6;5990:9;5986:22;5965:53;;;5955:63;;5927:97;6055:2;6073:53;6118:7;6109:6;6098:9;6094:22;6073:53;;;6063:63;;6034:98;6191:2;6180:9;6176:18;6163:32;6215:18;6207:6;6204:30;6201:2;;;6247:1;6244;6237:12;6201:2;6267:78;6337:7;6328:6;6317:9;6313:22;6267:78;;;6257:88;;6142:209;6410:2;6399:9;6395:18;6382:32;6434:18;6426:6;6423:30;6420:2;;;6466:1;6463;6456:12;6420:2;6486:78;6556:7;6547:6;6536:9;6532:22;6486:78;;;6476:88;;6361:209;5858:722;;;;;;;;6587:491;;;;6725:2;6713:9;6704:7;6700:23;6696:32;6693:2;;;6741:1;6738;6731:12;6693:2;6776:1;6793:53;6838:7;6829:6;6818:9;6814:22;6793:53;;;6783:63;;6755:97;6883:2;6901:53;6946:7;6937:6;6926:9;6922:22;6901:53;;;6891:63;;6862:98;6991:2;7009:53;7054:7;7045:6;7034:9;7030:22;7009:53;;;6999:63;;6970:98;6687:391;;;;;;7085:617;;;;;7240:3;7228:9;7219:7;7215:23;7211:33;7208:2;;;7257:1;7254;7247:12;7208:2;7292:1;7309:53;7354:7;7345:6;7334:9;7330:22;7309:53;;;7299:63;;7271:97;7399:2;7417:53;7462:7;7453:6;7442:9;7438:22;7417:53;;;7407:63;;7378:98;7507:2;7525:53;7570:7;7561:6;7550:9;7546:22;7525:53;;;7515:63;;7486:98;7615:2;7633:53;7678:7;7669:6;7658:9;7654:22;7633:53;;;7623:63;;7594:98;7202:500;;;;;;;;7709:743;;;;;;7881:3;7869:9;7860:7;7856:23;7852:33;7849:2;;;7898:1;7895;7888:12;7849:2;7933:1;7950:53;7995:7;7986:6;7975:9;7971:22;7950:53;;;7940:63;;7912:97;8040:2;8058:53;8103:7;8094:6;8083:9;8079:22;8058:53;;;8048:63;;8019:98;8148:2;8166:53;8211:7;8202:6;8191:9;8187:22;8166:53;;;8156:63;;8127:98;8256:2;8274:53;8319:7;8310:6;8299:9;8295:22;8274:53;;;8264:63;;8235:98;8364:3;8383:53;8428:7;8419:6;8408:9;8404:22;8383:53;;;8373:63;;8343:99;7843:609;;;;;;;;;8459:847;;;;;;8640:3;8628:9;8619:7;8615:23;8611:33;8608:2;;;8657:1;8654;8647:12;8608:2;8692:1;8709:53;8754:7;8745:6;8734:9;8730:22;8709:53;;;8699:63;;8671:97;8799:2;8817:53;8862:7;8853:6;8842:9;8838:22;8817:53;;;8807:63;;8778:98;8907:2;8925:53;8970:7;8961:6;8950:9;8946:22;8925:53;;;8915:63;;8886:98;9015:2;9033:53;9078:7;9069:6;9058:9;9054:22;9033:53;;;9023:63;;8994:98;9151:3;9140:9;9136:19;9123:33;9176:18;9168:6;9165:30;9162:2;;;9208:1;9205;9198:12;9162:2;9228:62;9282:7;9273:6;9262:9;9258:22;9228:62;;;9218:72;;9102:194;8602:704;;;;;;;;;9313:1011;;;;;;9533:3;9521:9;9512:7;9508:23;9504:33;9501:2;;;9550:1;9547;9540:12;9501:2;9585:1;9602:53;9647:7;9638:6;9627:9;9623:22;9602:53;;;9592:63;;9564:97;9692:2;9710:53;9755:7;9746:6;9735:9;9731:22;9710:53;;;9700:63;;9671:98;9800:2;9818:51;9861:7;9852:6;9841:9;9837:22;9818:51;;;9808:61;;9779:96;9934:2;9923:9;9919:18;9906:32;9958:18;9950:6;9947:30;9944:2;;;9990:1;9987;9980:12;9944:2;10010:78;10080:7;10071:6;10060:9;10056:22;10010:78;;;10000:88;;9885:209;10153:3;10142:9;10138:19;10125:33;10178:18;10170:6;10167:30;10164:2;;;10210:1;10207;10200:12;10164:2;10230:78;10300:7;10291:6;10280:9;10276:22;10230:78;;;10220:88;;10104:210;9495:829;;;;;;;;;10331:365;;;10454:2;10442:9;10433:7;10429:23;10425:32;10422:2;;;10470:1;10467;10460:12;10422:2;10533:1;10522:9;10518:17;10505:31;10556:18;10548:6;10545:30;10542:2;;;10588:1;10585;10578:12;10542:2;10616:64;10672:7;10663:6;10652:9;10648:22;10616:64;;;10598:82;;;;10484:202;10416:280;;;;;;10703:735;;;;;;10874:3;10862:9;10853:7;10849:23;10845:33;10842:2;;;10891:1;10888;10881:12;10842:2;10954:1;10943:9;10939:17;10926:31;10977:18;10969:6;10966:30;10963:2;;;11009:1;11006;10999:12;10963:2;11037:64;11093:7;11084:6;11073:9;11069:22;11037:64;;;11019:82;;;;10905:202;11138:2;11156:50;11198:7;11189:6;11178:9;11174:22;11156:50;;;11146:60;;11117:95;11243:2;11261:53;11306:7;11297:6;11286:9;11282:22;11261:53;;;11251:63;;11222:98;11351:2;11369:53;11414:7;11405:6;11394:9;11390:22;11369:53;;;11359:63;;11330:98;10836:602;;;;;;;;;11445:261;;11559:2;11547:9;11538:7;11534:23;11530:32;11527:2;;;11575:1;11572;11565:12;11527:2;11610:1;11627:63;11682:7;11673:6;11662:9;11658:22;11627:63;;;11617:73;;11589:107;11521:185;;;;;11713:241;;11817:2;11805:9;11796:7;11792:23;11788:32;11785:2;;;11833:1;11830;11823:12;11785:2;11868:1;11885:53;11930:7;11921:6;11910:9;11906:22;11885:53;;;11875:63;;11847:97;11779:175;;;;;11961:263;;12076:2;12064:9;12055:7;12051:23;12047:32;12044:2;;;12092:1;12089;12082:12;12044:2;12127:1;12144:64;12200:7;12191:6;12180:9;12176:22;12144:64;;;12134:74;;12106:108;12038:186;;;;;12231:382;;;12360:2;12348:9;12339:7;12335:23;12331:32;12328:2;;;12376:1;12373;12366:12;12328:2;12411:1;12428:53;12473:7;12464:6;12453:9;12449:22;12428:53;;;12418:63;;12390:97;12518:2;12536:61;12589:7;12580:6;12569:9;12565:22;12536:61;;;12526:71;;12497:106;12322:291;;;;;;12620:259;;12733:2;12721:9;12712:7;12708:23;12704:32;12701:2;;;12749:1;12746;12739:12;12701:2;12784:1;12801:62;12855:7;12846:6;12835:9;12831:22;12801:62;;;12791:72;;12763:106;12695:184;;;;;12886:132;12967:45;13006:5;12967:45;;;12962:3;12955:58;12949:69;;;13025:134;13114:39;13147:5;13114:39;;;13109:3;13102:52;13096:63;;;13166:110;13239:31;13264:5;13239:31;;;13234:3;13227:44;13221:55;;;13314:590;;13449:54;13497:5;13449:54;;;13521:6;13516:3;13509:19;13545:4;13540:3;13536:14;13529:21;;13590:56;13640:5;13590:56;;;13667:1;13652:230;13677:6;13674:1;13671:13;13652:230;;;13717:53;13766:3;13757:6;13751:13;13717:53;;;13787:60;13840:6;13787:60;;;13777:70;;13870:4;13865:3;13861:14;13854:21;;13699:1;13696;13692:9;13687:14;;13652:230;;;13656:14;13895:3;13888:10;;13428:476;;;;;;;13975:718;;14146:70;14210:5;14146:70;;;14234:6;14229:3;14222:19;14258:4;14253:3;14249:14;14242:21;;14303:72;14369:5;14303:72;;;14396:1;14381:290;14406:6;14403:1;14400:13;14381:290;;;14446:97;14539:3;14530:6;14524:13;14446:97;;;14560:76;14629:6;14560:76;;;14550:86;;14659:4;14654:3;14650:14;14643:21;;14428:1;14425;14421:9;14416:14;;14381:290;;;14385:14;14684:3;14677:10;;14125:568;;;;;;;14701:101;14768:28;14790:5;14768:28;;;14763:3;14756:41;14750:52;;;14809:110;14882:31;14907:5;14882:31;;;14877:3;14870:44;14864:55;;;14926:107;14997:30;15021:5;14997:30;;;14992:3;14985:43;14979:54;;;15040:297;;15140:38;15172:5;15140:38;;;15195:6;15190:3;15183:19;15207:63;15263:6;15256:4;15251:3;15247:14;15240:4;15233:5;15229:16;15207:63;;;15302:29;15324:6;15302:29;;;15295:4;15290:3;15286:14;15282:50;15275:57;;15120:217;;;;;;15344:300;;15446:39;15479:5;15446:39;;;15502:6;15497:3;15490:19;15514:63;15570:6;15563:4;15558:3;15554:14;15547:4;15540:5;15536:16;15514:63;;;15609:29;15631:6;15609:29;;;15602:4;15597:3;15593:14;15589:50;15582:57;;15426:218;;;;;;15652:296;;15807:2;15802:3;15795:15;15844:66;15839:2;15834:3;15830:12;15823:88;15939:2;15934:3;15930:12;15923:19;;15788:160;;;;15957:397;;16112:2;16107:3;16100:15;16149:66;16144:2;16139:3;16135:12;16128:88;16250:66;16245:2;16240:3;16236:12;16229:88;16345:2;16340:3;16336:12;16329:19;;16093:261;;;;16363:296;;16518:2;16513:3;16506:15;16555:66;16550:2;16545:3;16541:12;16534:88;16650:2;16645:3;16641:12;16634:19;;16499:160;;;;16668:296;;16823:2;16818:3;16811:15;16860:66;16855:2;16850:3;16846:12;16839:88;16955:2;16950:3;16946:12;16939:19;;16804:160;;;;16973:397;;17128:2;17123:3;17116:15;17165:66;17160:2;17155:3;17151:12;17144:88;17266:66;17261:2;17256:3;17252:12;17245:88;17361:2;17356:3;17352:12;17345:19;;17109:261;;;;17379:296;;17534:2;17529:3;17522:15;17571:66;17566:2;17561:3;17557:12;17550:88;17666:2;17661:3;17657:12;17650:19;;17515:160;;;;17684:397;;17839:2;17834:3;17827:15;17876:66;17871:2;17866:3;17862:12;17855:88;17977:66;17972:2;17967:3;17963:12;17956:88;18072:2;18067:3;18063:12;18056:19;;17820:261;;;;18090:397;;18245:2;18240:3;18233:15;18282:66;18277:2;18272:3;18268:12;18261:88;18383:66;18378:2;18373:3;18369:12;18362:88;18478:2;18473:3;18469:12;18462:19;;18226:261;;;;18496:296;;18651:2;18646:3;18639:15;18688:66;18683:2;18678:3;18674:12;18667:88;18783:2;18778:3;18774:12;18767:19;;18632:160;;;;18801:296;;18956:2;18951:3;18944:15;18993:66;18988:2;18983:3;18979:12;18972:88;19088:2;19083:3;19079:12;19072:19;;18937:160;;;;19106:296;;19261:2;19256:3;19249:15;19298:66;19293:2;19288:3;19284:12;19277:88;19393:2;19388:3;19384:12;19377:19;;19242:160;;;;19411:397;;19566:2;19561:3;19554:15;19603:66;19598:2;19593:3;19589:12;19582:88;19704:66;19699:2;19694:3;19690:12;19683:88;19799:2;19794:3;19790:12;19783:19;;19547:261;;;;19817:397;;19972:2;19967:3;19960:15;20009:66;20004:2;19999:3;19995:12;19988:88;20110:66;20105:2;20100:3;20096:12;20089:88;20205:2;20200:3;20196:12;20189:19;;19953:261;;;;20223:296;;20378:2;20373:3;20366:15;20415:66;20410:2;20405:3;20401:12;20394:88;20510:2;20505:3;20501:12;20494:19;;20359:160;;;;20528:296;;20683:2;20678:3;20671:15;20720:66;20715:2;20710:3;20706:12;20699:88;20815:2;20810:3;20806:12;20799:19;;20664:160;;;;20833:397;;20988:2;20983:3;20976:15;21025:66;21020:2;21015:3;21011:12;21004:88;21126:66;21121:2;21116:3;21112:12;21105:88;21221:2;21216:3;21212:12;21205:19;;20969:261;;;;21239:296;;21394:2;21389:3;21382:15;21431:66;21426:2;21421:3;21417:12;21410:88;21526:2;21521:3;21517:12;21510:19;;21375:160;;;;21544:397;;21699:2;21694:3;21687:15;21736:66;21731:2;21726:3;21722:12;21715:88;21837:66;21832:2;21827:3;21823:12;21816:88;21932:2;21927:3;21923:12;21916:19;;21680:261;;;;21950:397;;22105:2;22100:3;22093:15;22142:66;22137:2;22132:3;22128:12;22121:88;22243:66;22238:2;22233:3;22229:12;22222:88;22338:2;22333:3;22329:12;22322:19;;22086:261;;;;22356:296;;22511:2;22506:3;22499:15;22548:66;22543:2;22538:3;22534:12;22527:88;22643:2;22638:3;22634:12;22627:19;;22492:160;;;;22661:296;;22816:2;22811:3;22804:15;22853:66;22848:2;22843:3;22839:12;22832:88;22948:2;22943:3;22939:12;22932:19;;22797:160;;;;22966:296;;23121:2;23116:3;23109:15;23158:66;23153:2;23148:3;23144:12;23137:88;23253:2;23248:3;23244:12;23237:19;;23102:160;;;;23271:296;;23426:2;23421:3;23414:15;23463:66;23458:2;23453:3;23449:12;23442:88;23558:2;23553:3;23549:12;23542:19;;23407:160;;;;23576:296;;23731:2;23726:3;23719:15;23768:66;23763:2;23758:3;23754:12;23747:88;23863:2;23858:3;23854:12;23847:19;;23712:160;;;;23881:296;;24036:2;24031:3;24024:15;24073:66;24068:2;24063:3;24059:12;24052:88;24168:2;24163:3;24159:12;24152:19;;24017:160;;;;24186:296;;24341:2;24336:3;24329:15;24378:66;24373:2;24368:3;24364:12;24357:88;24473:2;24468:3;24464:12;24457:19;;24322:160;;;;24491:296;;24646:2;24641:3;24634:15;24683:66;24678:2;24673:3;24669:12;24662:88;24778:2;24773:3;24769:12;24762:19;;24627:160;;;;24852:488;24979:4;24974:3;24970:14;25065:3;25058:5;25054:15;25048:22;25082:61;25138:3;25133;25129:13;25116:11;25082:61;;;24999:156;25233:4;25226:5;25222:16;25216:23;25251:62;25307:4;25302:3;25298:14;25285:11;25251:62;;;25165:160;24952:388;;;;25400:641;;25539:4;25534:3;25530:14;25625:3;25618:5;25614:15;25608:22;25642:61;25698:3;25693;25689:13;25676:11;25642:61;;;25559:156;25794:4;25787:5;25783:16;25777:23;25845:3;25839:4;25835:14;25828:4;25823:3;25819:14;25812:38;25865:138;25998:4;25985:11;25865:138;;;25857:146;;25725:290;26032:4;26025:11;;25512:529;;;;;;26048:110;26121:31;26146:5;26121:31;;;26116:3;26109:44;26103:55;;;26165:107;26236:30;26260:5;26236:30;;;26231:3;26224:43;26218:54;;;26279:193;;26387:2;26376:9;26372:18;26364:26;;26401:61;26459:1;26448:9;26444:17;26435:6;26401:61;;;26358:114;;;;;26479:209;;26595:2;26584:9;26580:18;26572:26;;26609:69;26675:1;26664:9;26660:17;26651:6;26609:69;;;26566:122;;;;;26695:290;;26829:2;26818:9;26814:18;26806:26;;26843:61;26901:1;26890:9;26886:17;26877:6;26843:61;;;26915:60;26971:2;26960:9;26956:18;26947:6;26915:60;;;26800:185;;;;;;26992:341;;27150:2;27139:9;27135:18;27127:26;;27200:9;27194:4;27190:20;27186:1;27175:9;27171:17;27164:47;27225:98;27318:4;27309:6;27225:98;;;27217:106;;27121:212;;;;;27340:181;;27442:2;27431:9;27427:18;27419:26;;27456:55;27508:1;27497:9;27493:17;27484:6;27456:55;;;27413:108;;;;;27528:193;;27636:2;27625:9;27621:18;27613:26;;27650:61;27708:1;27697:9;27693:17;27684:6;27650:61;;;27607:114;;;;;27728:294;;27864:2;27853:9;27849:18;27841:26;;27878:61;27936:1;27925:9;27921:17;27912:6;27878:61;;;27950:62;28008:2;27997:9;27993:18;27984:6;27950:62;;;27835:187;;;;;;28029:277;;28155:2;28144:9;28140:18;28132:26;;28205:9;28199:4;28195:20;28191:1;28180:9;28176:17;28169:47;28230:66;28291:4;28282:6;28230:66;;;28222:74;;28126:180;;;;;28313:281;;28441:2;28430:9;28426:18;28418:26;;28491:9;28485:4;28481:20;28477:1;28466:9;28462:17;28455:47;28516:68;28579:4;28570:6;28516:68;;;28508:76;;28412:182;;;;;28601:387;;28782:2;28771:9;28767:18;28759:26;;28832:9;28826:4;28822:20;28818:1;28807:9;28803:17;28796:47;28857:121;28973:4;28857:121;;;28849:129;;28753:235;;;;28995:387;;29176:2;29165:9;29161:18;29153:26;;29226:9;29220:4;29216:20;29212:1;29201:9;29197:17;29190:47;29251:121;29367:4;29251:121;;;29243:129;;29147:235;;;;29389:387;;29570:2;29559:9;29555:18;29547:26;;29620:9;29614:4;29610:20;29606:1;29595:9;29591:17;29584:47;29645:121;29761:4;29645:121;;;29637:129;;29541:235;;;;29783:387;;29964:2;29953:9;29949:18;29941:26;;30014:9;30008:4;30004:20;30000:1;29989:9;29985:17;29978:47;30039:121;30155:4;30039:121;;;30031:129;;29935:235;;;;30177:387;;30358:2;30347:9;30343:18;30335:26;;30408:9;30402:4;30398:20;30394:1;30383:9;30379:17;30372:47;30433:121;30549:4;30433:121;;;30425:129;;30329:235;;;;30571:387;;30752:2;30741:9;30737:18;30729:26;;30802:9;30796:4;30792:20;30788:1;30777:9;30773:17;30766:47;30827:121;30943:4;30827:121;;;30819:129;;30723:235;;;;30965:387;;31146:2;31135:9;31131:18;31123:26;;31196:9;31190:4;31186:20;31182:1;31171:9;31167:17;31160:47;31221:121;31337:4;31221:121;;;31213:129;;31117:235;;;;31359:387;;31540:2;31529:9;31525:18;31517:26;;31590:9;31584:4;31580:20;31576:1;31565:9;31561:17;31554:47;31615:121;31731:4;31615:121;;;31607:129;;31511:235;;;;31753:387;;31934:2;31923:9;31919:18;31911:26;;31984:9;31978:4;31974:20;31970:1;31959:9;31955:17;31948:47;32009:121;32125:4;32009:121;;;32001:129;;31905:235;;;;32147:387;;32328:2;32317:9;32313:18;32305:26;;32378:9;32372:4;32368:20;32364:1;32353:9;32349:17;32342:47;32403:121;32519:4;32403:121;;;32395:129;;32299:235;;;;32541:387;;32722:2;32711:9;32707:18;32699:26;;32772:9;32766:4;32762:20;32758:1;32747:9;32743:17;32736:47;32797:121;32913:4;32797:121;;;32789:129;;32693:235;;;;32935:387;;33116:2;33105:9;33101:18;33093:26;;33166:9;33160:4;33156:20;33152:1;33141:9;33137:17;33130:47;33191:121;33307:4;33191:121;;;33183:129;;33087:235;;;;33329:387;;33510:2;33499:9;33495:18;33487:26;;33560:9;33554:4;33550:20;33546:1;33535:9;33531:17;33524:47;33585:121;33701:4;33585:121;;;33577:129;;33481:235;;;;33723:387;;33904:2;33893:9;33889:18;33881:26;;33954:9;33948:4;33944:20;33940:1;33929:9;33925:17;33918:47;33979:121;34095:4;33979:121;;;33971:129;;33875:235;;;;34117:387;;34298:2;34287:9;34283:18;34275:26;;34348:9;34342:4;34338:20;34334:1;34323:9;34319:17;34312:47;34373:121;34489:4;34373:121;;;34365:129;;34269:235;;;;34511:387;;34692:2;34681:9;34677:18;34669:26;;34742:9;34736:4;34732:20;34728:1;34717:9;34713:17;34706:47;34767:121;34883:4;34767:121;;;34759:129;;34663:235;;;;34905:387;;35086:2;35075:9;35071:18;35063:26;;35136:9;35130:4;35126:20;35122:1;35111:9;35107:17;35100:47;35161:121;35277:4;35161:121;;;35153:129;;35057:235;;;;35299:387;;35480:2;35469:9;35465:18;35457:26;;35530:9;35524:4;35520:20;35516:1;35505:9;35501:17;35494:47;35555:121;35671:4;35555:121;;;35547:129;;35451:235;;;;35693:387;;35874:2;35863:9;35859:18;35851:26;;35924:9;35918:4;35914:20;35910:1;35899:9;35895:17;35888:47;35949:121;36065:4;35949:121;;;35941:129;;35845:235;;;;36087:387;;36268:2;36257:9;36253:18;36245:26;;36318:9;36312:4;36308:20;36304:1;36293:9;36289:17;36282:47;36343:121;36459:4;36343:121;;;36335:129;;36239:235;;;;36481:387;;36662:2;36651:9;36647:18;36639:26;;36712:9;36706:4;36702:20;36698:1;36687:9;36683:17;36676:47;36737:121;36853:4;36737:121;;;36729:129;;36633:235;;;;36875:387;;37056:2;37045:9;37041:18;37033:26;;37106:9;37100:4;37096:20;37092:1;37081:9;37077:17;37070:47;37131:121;37247:4;37131:121;;;37123:129;;37027:235;;;;37269:387;;37450:2;37439:9;37435:18;37427:26;;37500:9;37494:4;37490:20;37486:1;37475:9;37471:17;37464:47;37525:121;37641:4;37525:121;;;37517:129;;37421:235;;;;37663:387;;37844:2;37833:9;37829:18;37821:26;;37894:9;37888:4;37884:20;37880:1;37869:9;37865:17;37858:47;37919:121;38035:4;37919:121;;;37911:129;;37815:235;;;;38057:387;;38238:2;38227:9;38223:18;38215:26;;38288:9;38282:4;38278:20;38274:1;38263:9;38259:17;38252:47;38313:121;38429:4;38313:121;;;38305:129;;38209:235;;;;38451:387;;38632:2;38621:9;38617:18;38609:26;;38682:9;38676:4;38672:20;38668:1;38657:9;38653:17;38646:47;38707:121;38823:4;38707:121;;;38699:129;;38603:235;;;;38845:387;;39026:2;39015:9;39011:18;39003:26;;39076:9;39070:4;39066:20;39062:1;39051:9;39047:17;39040:47;39101:121;39217:4;39101:121;;;39093:129;;38997:235;;;;39239:337;;39395:2;39384:9;39380:18;39372:26;;39445:9;39439:4;39435:20;39431:1;39420:9;39416:17;39409:47;39470:96;39561:4;39552:6;39470:96;;;39462:104;;39366:210;;;;;39583:193;;39691:2;39680:9;39676:18;39668:26;;39705:61;39763:1;39752:9;39748:17;39739:6;39705:61;;;39662:114;;;;;39783:294;;39919:2;39908:9;39904:18;39896:26;;39933:61;39991:1;39980:9;39976:17;39967:6;39933:61;;;40005:62;40063:2;40052:9;40048:18;40039:6;40005:62;;;39890:187;;;;;;40084:326;;40236:2;40225:9;40221:18;40213:26;;40250:61;40308:1;40297:9;40293:17;40284:6;40250:61;;;40322:78;40396:2;40385:9;40381:18;40372:6;40322:78;;;40207:203;;;;;;40417:378;;40571:2;40560:9;40556:18;40548:26;;40585:61;40643:1;40632:9;40628:17;40619:6;40585:61;;;40694:9;40688:4;40684:20;40679:2;40668:9;40664:18;40657:48;40719:66;40780:4;40771:6;40719:66;;;40711:74;;40542:253;;;;;;40802:189;;40908:2;40897:9;40893:18;40885:26;;40922:59;40978:1;40967:9;40963:17;40954:6;40922:59;;;40879:112;;;;;40998:256;;41060:2;41054:9;41044:19;;41098:4;41090:6;41086:17;41197:6;41185:10;41182:22;41161:18;41149:10;41146:34;41143:62;41140:2;;;41218:1;41215;41208:12;41140:2;41238:10;41234:2;41227:22;41038:216;;;;;41261:258;;41420:18;41412:6;41409:30;41406:2;;;41452:1;41449;41442:12;41406:2;41481:4;41473:6;41469:17;41461:25;;41509:4;41503;41499:15;41491:23;;41343:176;;;;41526:258;;41669:18;41661:6;41658:30;41655:2;;;41701:1;41698;41691:12;41655:2;41745:4;41741:9;41734:4;41726:6;41722:17;41718:33;41710:41;;41774:4;41768;41764:15;41756:23;;41592:192;;;;41793:121;;41902:4;41894:6;41890:17;41879:28;;41871:43;;;;41925:137;;42050:4;42042:6;42038:17;42027:28;;42019:43;;;;42071:107;;42167:5;42161:12;42151:22;;42145:33;;;;42185:123;;42297:5;42291:12;42281:22;;42275:33;;;;42315:91;;42395:5;42389:12;42379:22;;42373:33;;;;42413:92;;42494:5;42488:12;42478:22;;42472:33;;;;42513:122;;42624:4;42616:6;42612:17;42601:28;;42594:41;;;;42644:138;;42771:4;42763:6;42759:17;42748:28;;42741:41;;;;42790:105;;42859:31;42884:5;42859:31;;;42848:42;;42842:53;;;;42902:113;;42979:31;43004:5;42979:31;;;42968:42;;42962:53;;;;43022:92;;43102:5;43095:13;43088:21;43077:32;;43071:43;;;;43121:79;;43190:5;43179:16;;43173:27;;;;43207:151;;43286:66;43279:5;43275:78;43264:89;;43258:100;;;;43365:128;;43445:42;43438:5;43434:54;43423:65;;43417:76;;;;43500:79;;43569:5;43558:16;;43552:27;;;;43586:97;;43665:12;43658:5;43654:24;43643:35;;43637:46;;;;43690:105;;43759:31;43784:5;43759:31;;;43748:42;;43742:53;;;;43802:113;;43879:31;43904:5;43879:31;;;43868:42;;43862:53;;;;43922:92;;44002:5;43995:13;43988:21;43977:32;;43971:43;;;;44021:79;;44090:5;44079:16;;44073:27;;;;44107:91;;44186:6;44179:5;44175:18;44164:29;;44158:40;;;;44205:79;;44274:5;44263:16;;44257:27;;;;44291:88;;44369:4;44362:5;44358:16;44347:27;;44341:38;;;;44386:129;;44473:37;44504:5;44473:37;;;44460:50;;44454:61;;;;44522:121;;44601:37;44632:5;44601:37;;;44588:50;;44582:61;;;;44650:115;;44729:31;44754:5;44729:31;;;44716:44;;44710:55;;;;44773:145;44854:6;44849:3;44844;44831:30;44910:1;44901:6;44896:3;44892:16;44885:27;44824:94;;;;44927:268;44992:1;44999:101;45013:6;45010:1;45007:13;44999:101;;;45089:1;45084:3;45080:11;45074:18;45070:1;45065:3;45061:11;45054:39;45035:2;45032:1;45028:10;45023:15;;44999:101;;;45115:6;45112:1;45109:13;45106:2;;;45180:1;45171:6;45166:3;45162:16;45155:27;45106:2;44976:219;;;;;45203:97;;45291:2;45287:7;45282:2;45275:5;45271:14;45267:28;45257:38;;45251:49;;;";
var abi = [
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
		constant: false,
		inputs: [
			{
				name: "relayHubAddr",
				type: "address"
			},
			{
				name: "dateTimeAddr",
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
				name: "",
				type: "bytes32"
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
		DateTime: [
			798
		],
		ELAJSStore: [
			2161
		]
	},
	id: 2162,
	nodeType: "SourceUnit",
	nodes: [
		{
			id: 769,
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
			id: 770,
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
			id: 771,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 8640,
			src: "59:68:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol",
			file: "sol-datastructs/src/contracts/Bytes32SetDictionaryLib.sol",
			id: 772,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 6200,
			src: "197:67:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "sol-sql/src/contracts/src/structs/TableLib.sol",
			file: "sol-sql/src/contracts/src/structs/TableLib.sol",
			id: 773,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 10647,
			src: "313:56:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/ozEla/OwnableELA.sol",
			file: "./ozEla/OwnableELA.sol",
			id: 774,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 4730,
			src: "371:32:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/gsnEla/GSNRecipientELA.sol",
			file: "./gsnEla/GSNRecipientELA.sol",
			id: 775,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 3409,
			src: "404:38:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			absolutePath: "contracts/gsnEla/IRelayHubELA.sol",
			file: "./gsnEla/IRelayHubELA.sol",
			id: 776,
			nodeType: "ImportDirective",
			scope: 2162,
			sourceUnit: 3662,
			src: "443:35:1",
			symbolAliases: [
			],
			unitAlias: ""
		},
		{
			baseContracts: [
			],
			contractDependencies: [
			],
			contractKind: "contract",
			documentation: null,
			fullyImplemented: false,
			id: 798,
			linearizedBaseContracts: [
				798
			],
			name: "DateTime",
			nodeType: "ContractDefinition",
			nodes: [
				{
					body: null,
					documentation: null,
					id: 783,
					implemented: false,
					kind: "function",
					modifiers: [
					],
					name: "getYear",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 779,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 778,
								name: "timestamp",
								nodeType: "VariableDeclaration",
								scope: 783,
								src: "521:14:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 777,
									name: "uint",
									nodeType: "ElementaryTypeName",
									src: "521:4:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "520:16:1"
					},
					returnParameters: {
						id: 782,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 781,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 783,
								src: "558:6:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint16",
									typeString: "uint16"
								},
								typeName: {
									id: 780,
									name: "uint16",
									nodeType: "ElementaryTypeName",
									src: "558:6:1",
									typeDescriptions: {
										typeIdentifier: "t_uint16",
										typeString: "uint16"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "557:8:1"
					},
					scope: 798,
					src: "504:62:1",
					stateMutability: "pure",
					superFunction: null,
					visibility: "public"
				},
				{
					body: null,
					documentation: null,
					id: 790,
					implemented: false,
					kind: "function",
					modifiers: [
					],
					name: "getMonth",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 786,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 785,
								name: "timestamp",
								nodeType: "VariableDeclaration",
								scope: 790,
								src: "589:14:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 784,
									name: "uint",
									nodeType: "ElementaryTypeName",
									src: "589:4:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "588:16:1"
					},
					returnParameters: {
						id: 789,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 788,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 790,
								src: "626:5:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 787,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "626:5:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "625:7:1"
					},
					scope: 798,
					src: "571:62:1",
					stateMutability: "pure",
					superFunction: null,
					visibility: "public"
				},
				{
					body: null,
					documentation: null,
					id: 797,
					implemented: false,
					kind: "function",
					modifiers: [
					],
					name: "getDay",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 793,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 792,
								name: "timestamp",
								nodeType: "VariableDeclaration",
								scope: 797,
								src: "654:14:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 791,
									name: "uint",
									nodeType: "ElementaryTypeName",
									src: "654:4:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "653:16:1"
					},
					returnParameters: {
						id: 796,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 795,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 797,
								src: "691:5:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 794,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "691:5:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "690:7:1"
					},
					scope: 798,
					src: "638:60:1",
					stateMutability: "pure",
					superFunction: null,
					visibility: "public"
				}
			],
			scope: 2162,
			src: "480:220:1"
		},
		{
			baseContracts: [
				{
					"arguments": null,
					baseName: {
						contractScope: null,
						id: 799,
						name: "OwnableELA",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 4729,
						src: "885:10:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_OwnableELA_$4729",
							typeString: "contract OwnableELA"
						}
					},
					id: 800,
					nodeType: "InheritanceSpecifier",
					src: "885:10:1"
				},
				{
					"arguments": null,
					baseName: {
						contractScope: null,
						id: 801,
						name: "GSNRecipientELA",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 3408,
						src: "897:15:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_GSNRecipientELA_$3408",
							typeString: "contract GSNRecipientELA"
						}
					},
					id: 802,
					nodeType: "InheritanceSpecifier",
					src: "897:15:1"
				}
			],
			contractDependencies: [
				3342,
				3408,
				3712,
				3862,
				4536,
				4605,
				4729
			],
			contractKind: "contract",
			documentation: null,
			fullyImplemented: true,
			id: 2161,
			linearizedBaseContracts: [
				2161,
				3408,
				3862,
				3342,
				3712,
				4729,
				4536,
				4605
			],
			name: "ELAJSStore",
			nodeType: "ContractDefinition",
			nodes: [
				{
					constant: false,
					id: 804,
					name: "dateTime",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "1354:17:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_contract$_DateTime_$798",
						typeString: "contract DateTime"
					},
					typeName: {
						contractScope: null,
						id: 803,
						name: "DateTime",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 798,
						src: "1354:8:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_DateTime_$798",
							typeString: "contract DateTime"
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					constant: false,
					id: 808,
					name: "gsnCounter",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "1616:45:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_mapping$_t_bytes32_$_t_uint256_$",
						typeString: "mapping(bytes32 => uint256)"
					},
					typeName: {
						id: 807,
						keyType: {
							id: 805,
							name: "bytes32",
							nodeType: "ElementaryTypeName",
							src: "1624:7:1",
							typeDescriptions: {
								typeIdentifier: "t_bytes32",
								typeString: "bytes32"
							}
						},
						nodeType: "Mapping",
						src: "1616:27:1",
						typeDescriptions: {
							typeIdentifier: "t_mapping$_t_bytes32_$_t_uint256_$",
							typeString: "mapping(bytes32 => uint256)"
						},
						valueType: {
							id: 806,
							name: "uint256",
							nodeType: "ElementaryTypeName",
							src: "1635:7:1",
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
					id: 810,
					name: "gsnMaxCallsPerDay",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "1720:31:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_uint40",
						typeString: "uint40"
					},
					typeName: {
						id: 809,
						name: "uint40",
						nodeType: "ElementaryTypeName",
						src: "1720:6:1",
						typeDescriptions: {
							typeIdentifier: "t_uint40",
							typeString: "uint40"
						}
					},
					value: null,
					visibility: "public"
				},
				{
					id: 813,
					libraryName: {
						contractScope: null,
						id: 811,
						name: "PolymorphicDictionaryLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 8639,
						src: "1764:24:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_PolymorphicDictionaryLib_$8639",
							typeString: "library PolymorphicDictionaryLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1758:82:1",
					typeName: {
						contractScope: null,
						id: 812,
						name: "PolymorphicDictionaryLib.PolymorphicDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 7143,
						src: "1793:46:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage_ptr",
							typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
						}
					}
				},
				{
					id: 816,
					libraryName: {
						contractScope: null,
						id: 814,
						name: "Bytes32SetDictionaryLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 6199,
						src: "1851:23:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_Bytes32SetDictionaryLib_$6199",
							typeString: "library Bytes32SetDictionaryLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "1845:79:1",
					typeName: {
						contractScope: null,
						id: 815,
						name: "Bytes32SetDictionaryLib.Bytes32SetDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 5903,
						src: "1879:44:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage_ptr",
							typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
						}
					}
				},
				{
					constant: false,
					id: 820,
					name: "_table",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "2182:43:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
						typeString: "mapping(bytes32 => bytes32)"
					},
					typeName: {
						id: 819,
						keyType: {
							id: 817,
							name: "bytes32",
							nodeType: "ElementaryTypeName",
							src: "2190:7:1",
							typeDescriptions: {
								typeIdentifier: "t_bytes32",
								typeString: "bytes32"
							}
						},
						nodeType: "Mapping",
						src: "2182:27:1",
						typeDescriptions: {
							typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
							typeString: "mapping(bytes32 => bytes32)"
						},
						valueType: {
							id: 818,
							name: "bytes32",
							nodeType: "ElementaryTypeName",
							src: "2201:7:1",
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
					id: 822,
					name: "tableId",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "2318:61:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
						typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
					},
					typeName: {
						contractScope: null,
						id: 821,
						name: "Bytes32SetDictionaryLib.Bytes32SetDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 5903,
						src: "2318:44:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage_ptr",
							typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary"
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					id: 825,
					libraryName: {
						contractScope: null,
						id: 823,
						name: "TableLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10646,
						src: "2475:8:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_TableLib_$10646",
							typeString: "library TableLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "2469:34:1",
					typeName: {
						contractScope: null,
						id: 824,
						name: "TableLib.Table",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10411,
						src: "2488:14:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_Table_$10411_storage_ptr",
							typeString: "struct TableLib.Table"
						}
					}
				},
				{
					id: 828,
					libraryName: {
						contractScope: null,
						id: 826,
						name: "TableLib",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 10646,
						src: "2514:8:1",
						typeDescriptions: {
							typeIdentifier: "t_contract$_TableLib_$10646",
							typeString: "library TableLib"
						}
					},
					nodeType: "UsingForDirective",
					src: "2508:25:1",
					typeName: {
						id: 827,
						name: "bytes",
						nodeType: "ElementaryTypeName",
						src: "2527:5:1",
						typeDescriptions: {
							typeIdentifier: "t_bytes_storage_ptr",
							typeString: "bytes"
						}
					}
				},
				{
					constant: true,
					id: 831,
					name: "schemasTables",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "2695:106:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_bytes32",
						typeString: "bytes32"
					},
					typeName: {
						id: 829,
						name: "bytes32",
						nodeType: "ElementaryTypeName",
						src: "2695:7:1",
						typeDescriptions: {
							typeIdentifier: "t_bytes32",
							typeString: "bytes32"
						}
					},
					value: {
						argumentTypes: null,
						hexValue: "307837333633363836353664363137333265373037353632366336393633326537343631363236633635373330303030303030303030303030303030303030303030",
						id: 830,
						isConstant: false,
						isLValue: false,
						isPure: true,
						kind: "number",
						lValueRequested: false,
						nodeType: "Literal",
						src: "2735:66:1",
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
					id: 833,
					name: "database",
					nodeType: "VariableDeclaration",
					scope: 2161,
					src: "3076:64:1",
					stateVariable: true,
					storageLocation: "default",
					typeDescriptions: {
						typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
						typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
					},
					typeName: {
						contractScope: null,
						id: 832,
						name: "PolymorphicDictionaryLib.PolymorphicDictionary",
						nodeType: "UserDefinedTypeName",
						referencedDeclaration: 7143,
						src: "3076:46:1",
						typeDescriptions: {
							typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage_ptr",
							typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary"
						}
					},
					value: null,
					visibility: "internal"
				},
				{
					body: {
						id: 864,
						nodeType: "Block",
						src: "3330:166:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 846,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 842,
										name: "dateTime",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 804,
										src: "3340:8:1",
										typeDescriptions: {
											typeIdentifier: "t_contract$_DateTime_$798",
											typeString: "contract DateTime"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 844,
												name: "dateTimeAddr",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 837,
												src: "3360:12:1",
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
											id: 843,
											name: "DateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 798,
											src: "3351:8:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_DateTime_$798_$",
												typeString: "type(contract DateTime)"
											}
										},
										id: 845,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "3351:22:1",
										typeDescriptions: {
											typeIdentifier: "t_contract$_DateTime_$798",
											typeString: "contract DateTime"
										}
									},
									src: "3340:33:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_DateTime_$798",
										typeString: "contract DateTime"
									}
								},
								id: 847,
								nodeType: "ExpressionStatement",
								src: "3340:33:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											expression: {
												argumentTypes: null,
												id: 851,
												name: "msg",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 10661,
												src: "3405:3:1",
												typeDescriptions: {
													typeIdentifier: "t_magic_message",
													typeString: "msg"
												}
											},
											id: 852,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											memberName: "sender",
											nodeType: "MemberAccess",
											referencedDeclaration: null,
											src: "3405:10:1",
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
											id: 848,
											name: "OwnableELA",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 4729,
											src: "3383:10:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_OwnableELA_$4729_$",
												typeString: "type(contract OwnableELA)"
											}
										},
										id: 850,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "initialize",
										nodeType: "MemberAccess",
										referencedDeclaration: 4640,
										src: "3383:21:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_address_$returns$__$",
											typeString: "function (address)"
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
									src: "3383:33:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 854,
								nodeType: "ExpressionStatement",
								src: "3383:33:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 858,
											name: "relayHubAddr",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 835,
											src: "3453:12:1",
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
											id: 855,
											name: "GSNRecipientELA",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 3408,
											src: "3426:15:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_GSNRecipientELA_$3408_$",
												typeString: "type(contract GSNRecipientELA)"
											}
										},
										id: 857,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "initialize",
										nodeType: "MemberAccess",
										referencedDeclaration: 3371,
										src: "3426:26:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_address_$returns$__$",
											typeString: "function (address)"
										}
									},
									id: 859,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "3426:40:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 860,
								nodeType: "ExpressionStatement",
								src: "3426:40:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 861,
										name: "_initialize",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 882,
										src: "3476:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 862,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "3476:13:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 863,
								nodeType: "ExpressionStatement",
								src: "3476:13:1"
							}
						]
					},
					documentation: null,
					id: 865,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 840,
							modifierName: {
								argumentTypes: null,
								id: 839,
								name: "initializer",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4580,
								src: "3318:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "3318:11:1"
						}
					],
					name: "initialize",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 838,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 835,
								name: "relayHubAddr",
								nodeType: "VariableDeclaration",
								scope: 865,
								src: "3267:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 834,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "3267:7:1",
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
								id: 837,
								name: "dateTimeAddr",
								nodeType: "VariableDeclaration",
								scope: 865,
								src: "3289:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 836,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "3289:7:1",
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
						src: "3266:44:1"
					},
					returnParameters: {
						id: 841,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "3330:0:1"
					},
					scope: 2161,
					src: "3247:249:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 881,
						nodeType: "Block",
						src: "3534:247:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 870,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 868,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 810,
										src: "3544:17:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									nodeType: "Assignment",
									operator: "=",
									rightHandSide: {
										argumentTypes: null,
										hexValue: "31303030",
										id: 869,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "3564:4:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_1000_by_1",
											typeString: "int_const 1000"
										},
										value: "1000"
									},
									src: "3544:24:1",
									typeDescriptions: {
										typeIdentifier: "t_uint40",
										typeString: "uint40"
									}
								},
								id: 871,
								nodeType: "ExpressionStatement",
								src: "3544:24:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 875,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 831,
											src: "3704:13:1",
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
													id: 876,
													name: "PolymorphicDictionaryLib",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 8639,
													src: "3719:24:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_contract$_PolymorphicDictionaryLib_$8639_$",
														typeString: "type(library PolymorphicDictionaryLib)"
													}
												},
												id: 877,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												memberName: "DictionaryType",
												nodeType: "MemberAccess",
												referencedDeclaration: 7148,
												src: "3719:39:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_enum$_DictionaryType_$7148_$",
													typeString: "type(enum PolymorphicDictionaryLib.DictionaryType)"
												}
											},
											id: 878,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											memberName: "OneToManyFixed",
											nodeType: "MemberAccess",
											referencedDeclaration: null,
											src: "3719:54:1",
											typeDescriptions: {
												typeIdentifier: "t_enum$_DictionaryType_$7148",
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
												typeIdentifier: "t_enum$_DictionaryType_$7148",
												typeString: "enum PolymorphicDictionaryLib.DictionaryType"
											}
										],
										expression: {
											argumentTypes: null,
											id: 872,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "3688:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 874,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8566,
										src: "3688:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_enum$_DictionaryType_$7148_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,enum PolymorphicDictionaryLib.DictionaryType) returns (bool)"
										}
									},
									id: 879,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "3688:86:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 880,
								nodeType: "ExpressionStatement",
								src: "3688:86:1"
							}
						]
					},
					documentation: null,
					id: 882,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_initialize",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 866,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "3522:2:1"
					},
					returnParameters: {
						id: 867,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "3534:0:1"
					},
					scope: 2161,
					src: "3502:279:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 940,
						nodeType: "Block",
						src: "4298:763:1",
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
											id: 904,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												baseExpression: {
													argumentTypes: null,
													id: 900,
													name: "_table",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 820,
													src: "4592:6:1",
													typeDescriptions: {
														typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
														typeString: "mapping(bytes32 => bytes32)"
													}
												},
												id: 902,
												indexExpression: {
													argumentTypes: null,
													id: 901,
													name: "tableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 886,
													src: "4599:8:1",
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
												src: "4592:16:1",
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
												id: 903,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "4612:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "4592:21:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "5461626c6520616c726561647920657869737473",
											id: 905,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "4615:22:1",
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
										id: 899,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "4584:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 906,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4584:54:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 907,
								nodeType: "ExpressionStatement",
								src: "4584:54:1"
							},
							{
								assignments: [
									909
								],
								declarations: [
									{
										constant: false,
										id: 909,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 940,
										src: "4649:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 908,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "4649:7:1",
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
								id: 913,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											hexValue: "307830",
											id: 911,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "4676:3:1",
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
										id: 910,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "4668:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_address_$",
											typeString: "type(address)"
										},
										typeName: "address"
									},
									id: 912,
									isConstant: false,
									isLValue: false,
									isPure: true,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4668:12:1",
									typeDescriptions: {
										typeIdentifier: "t_address_payable",
										typeString: "address payable"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "4649:31:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 915,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 886,
											src: "4759:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 916,
											name: "permission",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 888,
											src: "4769:10:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										{
											argumentTypes: null,
											id: 917,
											name: "delegate",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 909,
											src: "4781:8:1",
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
										id: 914,
										name: "setTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1910,
										src: "4742:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_uint8_$_t_address_$returns$__$",
											typeString: "function (bytes32,uint8,address)"
										}
									},
									id: 918,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4742:48:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 919,
								nodeType: "ExpressionStatement",
								src: "4742:48:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 923,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 831,
											src: "4825:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 924,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 884,
											src: "4840:9:1",
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
											id: 920,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "4801:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 922,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8305,
										src: "4801:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 925,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4801:49:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 926,
								nodeType: "ExpressionStatement",
								src: "4801:49:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 930,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 886,
											src: "4945:8:1",
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
											id: 927,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "4930:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 929,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 5919,
										src: "4930:14:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 931,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4930:24:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 932,
								nodeType: "ExpressionStatement",
								src: "4930:24:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 934,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 884,
											src: "5009:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 935,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 886,
											src: "5020:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 936,
											name: "columnName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 891,
											src: "5030:10:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										},
										{
											argumentTypes: null,
											id: 937,
											name: "columnDtype",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 894,
											src: "5042:11:1",
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
										id: 933,
										name: "saveSchema",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1023,
										src: "4998:10:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_array$_t_bytes32_$dyn_memory_ptr_$_t_array$_t_bytes32_$dyn_memory_ptr_$returns$_t_bool_$",
											typeString: "function (bytes32,bytes32,bytes32[] memory,bytes32[] memory) returns (bool)"
										}
									},
									id: 938,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "4998:56:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 939,
								nodeType: "ExpressionStatement",
								src: "4998:56:1"
							}
						]
					},
					documentation: "@dev create a new table, only the owner may create this\n     * @param tableName right padded zeroes (Web3.utils.stringToHex)\n@param tableKey this is the namehash of tableName",
					id: 941,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 897,
							modifierName: {
								argumentTypes: null,
								id: 896,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "4288:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "4288:9:1"
						}
					],
					name: "createTable",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 895,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 884,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 941,
								src: "4129:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 883,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "4129:7:1",
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
								id: 886,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 941,
								src: "4156:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 885,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "4156:7:1",
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
								id: 888,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 941,
								src: "4182:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 887,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "4182:5:1",
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
								id: 891,
								name: "columnName",
								nodeType: "VariableDeclaration",
								scope: 941,
								src: "4208:27:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 889,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "4208:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 890,
									length: null,
									nodeType: "ArrayTypeName",
									src: "4208:9:1",
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
								id: 894,
								name: "columnDtype",
								nodeType: "VariableDeclaration",
								scope: 941,
								src: "4245:28:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 892,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "4245:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 893,
									length: null,
									nodeType: "ArrayTypeName",
									src: "4245:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "4119:161:1"
					},
					returnParameters: {
						id: 898,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "4298:0:1"
					},
					scope: 2161,
					src: "4099:962:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 969,
						nodeType: "Block",
						src: "5197:136:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 954,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 950,
											name: "_table",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 820,
											src: "5207:6:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
												typeString: "mapping(bytes32 => bytes32)"
											}
										},
										id: 952,
										indexExpression: {
											argumentTypes: null,
											id: 951,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 945,
											src: "5214:8:1",
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
										src: "5207:16:1",
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
										id: 953,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "5226:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_0_by_1",
											typeString: "int_const 0"
										},
										value: "0"
									},
									src: "5207:20:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								id: 955,
								nodeType: "ExpressionStatement",
								src: "5207:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 959,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 831,
											src: "5264:13:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 960,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 943,
											src: "5279:9:1",
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
											id: 956,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "5237:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 958,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8619,
										src: "5237:26:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 961,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5237:52:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 962,
								nodeType: "ExpressionStatement",
								src: "5237:52:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 966,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 945,
											src: "5317:8:1",
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
											id: 963,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "5299:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 965,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6032,
										src: "5299:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 967,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5299:27:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 968,
								nodeType: "ExpressionStatement",
								src: "5299:27:1"
							}
						]
					},
					documentation: null,
					id: 970,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 948,
							modifierName: {
								argumentTypes: null,
								id: 947,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "5187:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "5187:9:1"
						}
					],
					name: "deleteTable",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 946,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 943,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 970,
								src: "5130:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 942,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5130:7:1",
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
								id: 945,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 970,
								src: "5157:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 944,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5157:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5120:59:1"
					},
					returnParameters: {
						id: 949,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "5197:0:1"
					},
					scope: 2161,
					src: "5100:233:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 981,
						nodeType: "Block",
						src: "5400:77:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 978,
											name: "schemasTables",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 831,
											src: "5456:13:1",
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
											id: 976,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "5417:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 977,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "enumerateForKeyOneToManyFixed",
										nodeType: "MemberAccess",
										referencedDeclaration: 7400,
										src: "5417:38:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_array$_t_bytes32_$dyn_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32[] memory)"
										}
									},
									id: 979,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5417:53:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
										typeString: "bytes32[] memory"
									}
								},
								functionReturnParameters: 975,
								id: 980,
								nodeType: "Return",
								src: "5410:60:1"
							}
						]
					},
					documentation: null,
					id: 982,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTables",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 971,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "5357:2:1"
					},
					returnParameters: {
						id: 975,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 974,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 982,
								src: "5383:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 972,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "5383:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 973,
									length: null,
									nodeType: "ArrayTypeName",
									src: "5383:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5382:18:1"
					},
					scope: 2161,
					src: "5339:138:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1022,
						nodeType: "Block",
						src: "5809:331:1",
						statements: [
							{
								assignments: [
									1002
								],
								declarations: [
									{
										constant: false,
										id: 1002,
										name: "tableSchema",
										nodeType: "VariableDeclaration",
										scope: 1022,
										src: "5820:33:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_struct$_Table_$10411_memory_ptr",
											typeString: "struct TableLib.Table"
										},
										typeName: {
											contractScope: null,
											id: 1001,
											name: "TableLib.Table",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 10411,
											src: "5820:14:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Table_$10411_storage_ptr",
												typeString: "struct TableLib.Table"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1009,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1005,
											name: "tableName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 984,
											src: "5885:9:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1006,
											name: "columnName",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 989,
											src: "5908:10:1",
											typeDescriptions: {
												typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
												typeString: "bytes32[] memory"
											}
										},
										{
											argumentTypes: null,
											id: 1007,
											name: "columnDtype",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 992,
											src: "5932:11:1",
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
											id: 1003,
											name: "TableLib",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10646,
											src: "5856:8:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_contract$_TableLib_$10646_$",
												typeString: "type(library TableLib)"
											}
										},
										id: 1004,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "create",
										nodeType: "MemberAccess",
										referencedDeclaration: 10511,
										src: "5856:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_array$_t_bytes32_$dyn_memory_ptr_$_t_array$_t_bytes32_$dyn_memory_ptr_$returns$_t_struct$_Table_$10411_memory_ptr_$",
											typeString: "function (bytes32,bytes32[] memory,bytes32[] memory) pure returns (struct TableLib.Table memory)"
										}
									},
									id: 1008,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5856:97:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10411_memory_ptr",
										typeString: "struct TableLib.Table memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5820:133:1"
							},
							{
								assignments: [
									1011
								],
								declarations: [
									{
										constant: false,
										id: 1011,
										name: "encoded",
										nodeType: "VariableDeclaration",
										scope: 1022,
										src: "5964:20:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 1010,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "5964:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1015,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										expression: {
											argumentTypes: null,
											id: 1012,
											name: "tableSchema",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1002,
											src: "5987:11:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Table_$10411_memory_ptr",
												typeString: "struct TableLib.Table memory"
											}
										},
										id: 1013,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "encode",
										nodeType: "MemberAccess",
										referencedDeclaration: 10563,
										src: "5987:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_struct$_Table_$10411_memory_ptr_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_Table_$10411_memory_ptr_$",
											typeString: "function (struct TableLib.Table memory) pure returns (bytes memory)"
										}
									},
									id: 1014,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "5987:20:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory_ptr",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "5964:43:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1018,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 986,
											src: "6115:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1019,
											name: "encoded",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1011,
											src: "6125:7:1",
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
											id: 1016,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "6091:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1017,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8256,
										src: "6091:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes_memory_ptr_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes memory) returns (bool)"
										}
									},
									id: 1020,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6091:42:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 998,
								id: 1021,
								nodeType: "Return",
								src: "6084:49:1"
							}
						]
					},
					documentation: null,
					id: 1023,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 995,
							modifierName: {
								argumentTypes: null,
								id: 994,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "5784:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "5784:9:1"
						}
					],
					name: "saveSchema",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 993,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 984,
								name: "tableName",
								nodeType: "VariableDeclaration",
								scope: 1023,
								src: "5651:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 983,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5651:7:1",
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
								id: 986,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1023,
								src: "5678:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 985,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "5678:7:1",
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
								id: 989,
								name: "columnName",
								nodeType: "VariableDeclaration",
								scope: 1023,
								src: "5704:27:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 987,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "5704:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 988,
									length: null,
									nodeType: "ArrayTypeName",
									src: "5704:9:1",
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
								id: 992,
								name: "columnDtype",
								nodeType: "VariableDeclaration",
								scope: 1023,
								src: "5741:28:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 990,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "5741:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 991,
									length: null,
									nodeType: "ArrayTypeName",
									src: "5741:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5641:135:1"
					},
					returnParameters: {
						id: 998,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 997,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1023,
								src: "5803:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 996,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "5803:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "5802:6:1"
					},
					scope: 2161,
					src: "5622:518:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1041,
						nodeType: "Block",
						src: "6244:108:1",
						statements: [
							{
								assignments: [
									1031
								],
								declarations: [
									{
										constant: false,
										id: 1031,
										name: "encoded",
										nodeType: "VariableDeclaration",
										scope: 1041,
										src: "6254:20:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 1030,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "6254:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1036,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1034,
											name: "_name",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1025,
											src: "6301:5:1",
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
											id: 1032,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "6277:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1033,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "getBytesForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7716,
										src: "6277:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes memory)"
										}
									},
									id: 1035,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6277:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory_ptr",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "6254:53:1"
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
											id: 1037,
											name: "encoded",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1031,
											src: "6324:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_memory_ptr",
												typeString: "bytes memory"
											}
										},
										id: 1038,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "decodeTable",
										nodeType: "MemberAccess",
										referencedDeclaration: 10612,
										src: "6324:19:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes_memory_ptr_$returns$_t_struct$_Table_$10411_memory_ptr_$bound_to$_t_bytes_memory_ptr_$",
											typeString: "function (bytes memory) pure returns (struct TableLib.Table memory)"
										}
									},
									id: 1039,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6324:21:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10411_memory_ptr",
										typeString: "struct TableLib.Table memory"
									}
								},
								functionReturnParameters: 1029,
								id: 1040,
								nodeType: "Return",
								src: "6317:28:1"
							}
						]
					},
					documentation: null,
					id: 1042,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getSchema",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1026,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1025,
								name: "_name",
								nodeType: "VariableDeclaration",
								scope: 1042,
								src: "6185:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1024,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6185:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "6184:15:1"
					},
					returnParameters: {
						id: 1029,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1028,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1042,
								src: "6221:21:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_struct$_Table_$10411_memory_ptr",
									typeString: "struct TableLib.Table"
								},
								typeName: {
									contractScope: null,
									id: 1027,
									name: "TableLib.Table",
									nodeType: "UserDefinedTypeName",
									referencedDeclaration: 10411,
									src: "6221:14:1",
									typeDescriptions: {
										typeIdentifier: "t_struct$_Table_$10411_storage_ptr",
										typeString: "struct TableLib.Table"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "6220:23:1"
					},
					scope: 2161,
					src: "6166:186:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1079,
						nodeType: "Block",
						src: "6554:423:1",
						statements: [
							{
								assignments: [
									1047,
									1049
								],
								declarations: [
									{
										constant: false,
										id: 1047,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1079,
										src: "6566:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1046,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "6566:7:1",
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
										id: 1049,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1079,
										src: "6586:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1048,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "6586:7:1",
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
								id: 1053,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1051,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1044,
											src: "6623:8:1",
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
										id: 1050,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1875,
										src: "6606:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1052,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6606:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "6565:67:1"
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
											id: 1057,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1055,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1047,
												src: "6715:10:1",
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
												id: 1056,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "6728:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "6715:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65",
											id: 1058,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "6731:33:1",
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
										id: 1054,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "6707:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1059,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6707:58:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1060,
								nodeType: "ExpressionStatement",
								src: "6707:58:1"
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
											id: 1074,
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
												id: 1069,
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
													id: 1064,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1062,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1047,
														src: "6844:10:1",
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
														id: 1063,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "6857:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "6844:14:1",
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
													id: 1068,
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
															id: 1065,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4669,
															src: "6862:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1066,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "6862:9:1",
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
														id: 1067,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "6875:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "6862:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "6844:35:1",
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
												id: 1073,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1070,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1049,
													src: "6883:8:1",
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
														id: 1071,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3257
														],
														referencedDeclaration: 3257,
														src: "6895:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1072,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "6895:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "6883:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "6844:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e20494e5345525420696e746f2074686973207461626c65",
											id: 1075,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "6909:48:1",
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
										id: 1061,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "6836:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1076,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "6836:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1077,
								nodeType: "ExpressionStatement",
								src: "6836:122:1"
							},
							{
								id: 1078,
								nodeType: "PlaceholderStatement",
								src: "6969:1:1"
							}
						]
					},
					documentation: "@dev Table level permission checks",
					id: 1080,
					name: "insertCheck",
					nodeType: "ModifierDefinition",
					parameters: {
						id: 1045,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1044,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1080,
								src: "6536:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1043,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "6536:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "6535:18:1"
					},
					src: "6515:462:1",
					visibility: "internal"
				},
				{
					anonymous: false,
					documentation: "Primarily exists to assist in query WHERE searches, therefore we\nwant the index to exist on the value and table, filtering on owner\nis important for performance",
					id: 1092,
					name: "InsertVal",
					nodeType: "EventDefinition",
					parameters: {
						id: 1091,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1082,
								indexed: true,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1092,
								src: "7208:24:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1081,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7208:7:1",
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
								id: 1084,
								indexed: true,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1092,
								src: "7242:24:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1083,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7242:7:1",
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
								id: 1086,
								indexed: true,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1092,
								src: "7276:19:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1085,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7276:7:1",
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
								id: 1088,
								indexed: false,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1092,
								src: "7306:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1087,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7306:7:1",
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
								id: 1090,
								indexed: false,
								name: "owner",
								nodeType: "VariableDeclaration",
								scope: 1092,
								src: "7327:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1089,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "7327:7:1",
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
						src: "7198:148:1"
					},
					src: "7182:165:1"
				},
				{
					body: {
						id: 1174,
						nodeType: "Block",
						src: "7842:1015:1",
						statements: [
							{
								assignments: [
									1109
								],
								declarations: [
									{
										constant: false,
										id: 1109,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1174,
										src: "7853:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1108,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "7853:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1114,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1111,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1096,
											src: "7883:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1112,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1094,
											src: "7890:8:1",
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
										id: 1110,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "7874:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1113,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7874:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "7853:46:1"
							},
							{
								assignments: [
									1116
								],
								declarations: [
									{
										constant: false,
										id: 1116,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1174,
										src: "7909:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1115,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "7909:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1121,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1118,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1098,
											src: "7944:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1119,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1109,
											src: "7954:10:1",
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
										id: 1117,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "7935:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1120,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7935:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "7909:56:1"
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
											id: 1128,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1125,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1116,
														src: "8005:15:1",
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
														id: 1123,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "7984:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1124,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7451,
													src: "7984:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
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
												src: "7984:37:1",
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
												id: 1127,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "8025:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "7984:46:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "69642b6669656c6420616c726561647920657869737473",
											id: 1129,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "8032:25:1",
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
										id: 1122,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "7976:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1130,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "7976:82:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1131,
								nodeType: "ExpressionStatement",
								src: "7976:82:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1132,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2000,
										src: "8098:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1133,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8098:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1134,
								nodeType: "ExpressionStatement",
								src: "8098:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1138,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1094,
											src: "8320:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1139,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1100,
											src: "8330:2:1",
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
											id: 1135,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "8297:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1137,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6007,
										src: "8297:22:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1140,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8297:36:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1141,
								nodeType: "ExpressionStatement",
								src: "8297:36:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									},
									id: 1147,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1144,
												name: "idTableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1109,
												src: "8480:10:1",
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
												id: 1142,
												name: "database",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 833,
												src: "8459:8:1",
												typeDescriptions: {
													typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
													typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
												}
											},
											id: 1143,
											isConstant: false,
											isLValue: true,
											isPure: false,
											lValueRequested: false,
											memberName: "containsKey",
											nodeType: "MemberAccess",
											referencedDeclaration: 7451,
											src: "8459:20:1",
											typeDescriptions: {
												typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
												typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
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
										src: "8459:32:1",
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
										id: 1146,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "bool",
										lValueRequested: false,
										nodeType: "Literal",
										src: "8495:5:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										value: "false"
									},
									src: "8459:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1155,
								nodeType: "IfStatement",
								src: "8455:109:1",
								trueBody: {
									id: 1154,
									nodeType: "Block",
									src: "8501:63:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1149,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1109,
														src: "8528:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1150,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1100,
														src: "8540:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1151,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1094,
														src: "8544:8:1",
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
													id: 1148,
													name: "_setRowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1337,
													src: "8515:12:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
														typeString: "function (bytes32,bytes32,bytes32)"
													}
												},
												id: 1152,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "8515:38:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$__$",
													typeString: "tuple()"
												}
											},
											id: 1153,
											nodeType: "ExpressionStatement",
											src: "8515:38:1"
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
											id: 1159,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1116,
											src: "8705:15:1",
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
													id: 1161,
													name: "val",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1102,
													src: "8730:3:1",
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
												id: 1160,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "8722:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1162,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "8722:12:1",
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
											id: 1156,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "8681:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1158,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8109,
										src: "8681:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1163,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8681:54:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1164,
								nodeType: "ExpressionStatement",
								src: "8681:54:1"
							},
							{
								eventCall: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1166,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1094,
											src: "8807:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1167,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1098,
											src: "8817:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1168,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1102,
											src: "8827:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1169,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1100,
											src: "8832:2:1",
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
												id: 1170,
												name: "_msgSender",
												nodeType: "Identifier",
												overloadedDeclarations: [
													3257
												],
												referencedDeclaration: 3257,
												src: "8836:10:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 1171,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "8836:12:1",
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
										id: 1165,
										name: "InsertVal",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1092,
										src: "8797:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_event_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_address_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32,address)"
										}
									},
									id: 1172,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "8797:52:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1173,
								nodeType: "EmitStatement",
								src: "8792:57:1"
							}
						]
					},
					documentation: "@dev Prior to insert, we check the permissions and autoIncrement\nTODO: use the schema and determine the proper type of data to insert\n     * @param tableKey the namehashed [table] name string\n@param idKey the sha3 hashed idKey\n@param id as the raw string (unhashed)",
					id: 1175,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": [
								{
									argumentTypes: null,
									id: 1105,
									name: "tableKey",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1094,
									src: "7833:8:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								}
							],
							id: 1106,
							modifierName: {
								argumentTypes: null,
								id: 1104,
								name: "insertCheck",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 1080,
								src: "7821:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$_t_bytes32_$",
									typeString: "modifier (bytes32)"
								}
							},
							nodeType: "ModifierInvocation",
							src: "7821:21:1"
						}
					],
					name: "insertVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1103,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1094,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1175,
								src: "7700:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1093,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7700:7:1",
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
								id: 1096,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1175,
								src: "7726:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1095,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7726:7:1",
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
								id: 1098,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1175,
								src: "7749:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1097,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7749:7:1",
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
								id: 1100,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1175,
								src: "7776:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1099,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7776:7:1",
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
								id: 1102,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1175,
								src: "7796:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1101,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "7796:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "7689:119:1"
					},
					returnParameters: {
						id: 1107,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "7842:0:1"
					},
					scope: 2161,
					src: "7671:1186:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1246,
						nodeType: "Block",
						src: "9041:713:1",
						statements: [
							{
								assignments: [
									1192
								],
								declarations: [
									{
										constant: false,
										id: 1192,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1246,
										src: "9052:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1191,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "9052:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1197,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1194,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1179,
											src: "9082:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1195,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1177,
											src: "9089:8:1",
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
										id: 1193,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "9073:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1196,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9073:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "9052:46:1"
							},
							{
								assignments: [
									1199
								],
								declarations: [
									{
										constant: false,
										id: 1199,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1246,
										src: "9108:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1198,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "9108:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1204,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1201,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1181,
											src: "9143:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1202,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1192,
											src: "9153:10:1",
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
										id: 1200,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "9134:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1203,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9134:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "9108:56:1"
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
											id: 1211,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1208,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1199,
														src: "9204:15:1",
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
														id: 1206,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "9183:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1207,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7451,
													src: "9183:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
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
												src: "9183:37:1",
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
												id: 1210,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "9224:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "9183:46:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "69642b6669656c6420616c726561647920657869737473",
											id: 1212,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "9231:25:1",
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
										id: 1205,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "9175:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1213,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9175:82:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1214,
								nodeType: "ExpressionStatement",
								src: "9175:82:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1215,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2000,
										src: "9297:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1216,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9297:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1217,
								nodeType: "ExpressionStatement",
								src: "9297:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1221,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1177,
											src: "9416:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1222,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1183,
											src: "9426:2:1",
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
											id: 1218,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "9393:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1220,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "addValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6007,
										src: "9393:22:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1223,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9393:36:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1224,
								nodeType: "ExpressionStatement",
								src: "9393:36:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									},
									id: 1230,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										"arguments": [
											{
												argumentTypes: null,
												id: 1227,
												name: "idTableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1192,
												src: "9576:10:1",
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
												id: 1225,
												name: "database",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 833,
												src: "9555:8:1",
												typeDescriptions: {
													typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
													typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
												}
											},
											id: 1226,
											isConstant: false,
											isLValue: true,
											isPure: false,
											lValueRequested: false,
											memberName: "containsKey",
											nodeType: "MemberAccess",
											referencedDeclaration: 7451,
											src: "9555:20:1",
											typeDescriptions: {
												typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
												typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
											}
										},
										id: 1228,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "functionCall",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "9555:32:1",
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
										id: 1229,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "bool",
										lValueRequested: false,
										nodeType: "Literal",
										src: "9591:5:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										value: "false"
									},
									src: "9555:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1238,
								nodeType: "IfStatement",
								src: "9551:109:1",
								trueBody: {
									id: 1237,
									nodeType: "Block",
									src: "9597:63:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1232,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1192,
														src: "9624:10:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1233,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1183,
														src: "9636:2:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1234,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1177,
														src: "9640:8:1",
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
													id: 1231,
													name: "_setRowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1337,
													src: "9611:12:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
														typeString: "function (bytes32,bytes32,bytes32)"
													}
												},
												id: 1235,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "9611:38:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$__$",
													typeString: "tuple()"
												}
											},
											id: 1236,
											nodeType: "ExpressionStatement",
											src: "9611:38:1"
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
											id: 1242,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1199,
											src: "9726:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1243,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1185,
											src: "9743:3:1",
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
											id: 1239,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "9702:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1241,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8256,
										src: "9702:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes_memory_ptr_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes memory) returns (bool)"
										}
									},
									id: 1244,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "9702:45:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1245,
								nodeType: "ExpressionStatement",
								src: "9702:45:1"
							}
						]
					},
					documentation: null,
					id: 1247,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": [
								{
									argumentTypes: null,
									id: 1188,
									name: "tableKey",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1177,
									src: "9032:8:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								}
							],
							id: 1189,
							modifierName: {
								argumentTypes: null,
								id: 1187,
								name: "insertCheck",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 1080,
								src: "9020:11:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$_t_bytes32_$",
									typeString: "modifier (bytes32)"
								}
							},
							nodeType: "ModifierInvocation",
							src: "9020:21:1"
						}
					],
					name: "insertValVar",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1186,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1177,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1247,
								src: "8894:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1176,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8894:7:1",
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
								id: 1179,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1247,
								src: "8920:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1178,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8920:7:1",
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
								id: 1181,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1247,
								src: "8943:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1180,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8943:7:1",
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
								id: 1183,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1247,
								src: "8970:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1182,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "8970:7:1",
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
								id: 1185,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1247,
								src: "8990:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1184,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "8990:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "8884:123:1"
					},
					returnParameters: {
						id: 1190,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "9041:0:1"
					},
					scope: 2161,
					src: "8863:891:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1336,
						nodeType: "Block",
						src: "9966:605:1",
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
											id: 1262,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1259,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1249,
														src: "10006:10:1",
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
														id: 1257,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "9985:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1258,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7451,
													src: "9985:20:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
													}
												},
												id: 1260,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "9985:32:1",
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
												id: 1261,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "10021:5:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "false"
											},
											src: "9985:41:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "726f7720616c726561647920686173206f776e6572",
											id: 1263,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10028:23:1",
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
										id: 1256,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "9977:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
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
									src: "9977:75:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1265,
								nodeType: "ExpressionStatement",
								src: "9977:75:1"
							},
							{
								assignments: [
									1267
								],
								declarations: [
									{
										constant: false,
										id: 1267,
										name: "rowMetadata",
										nodeType: "VariableDeclaration",
										scope: 1336,
										src: "10063:19:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1266,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "10063:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1268,
								initialValue: null,
								nodeType: "VariableDeclarationStatement",
								src: "10063:19:1"
							},
							{
								assignments: [
									1270
								],
								declarations: [
									{
										constant: false,
										id: 1270,
										name: "year",
										nodeType: "VariableDeclaration",
										scope: 1336,
										src: "10093:11:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint16",
											typeString: "uint16"
										},
										typeName: {
											id: 1269,
											name: "uint16",
											nodeType: "ElementaryTypeName",
											src: "10093:6:1",
											typeDescriptions: {
												typeIdentifier: "t_uint16",
												typeString: "uint16"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1275,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1273,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "10124:3:1",
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
										expression: {
											argumentTypes: null,
											id: 1271,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "10107:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 1272,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getYear",
										nodeType: "MemberAccess",
										referencedDeclaration: 783,
										src: "10107:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint16_$",
											typeString: "function (uint256) pure external returns (uint16)"
										}
									},
									id: 1274,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10107:21:1",
									typeDescriptions: {
										typeIdentifier: "t_uint16",
										typeString: "uint16"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10093:35:1"
							},
							{
								assignments: [
									1277
								],
								declarations: [
									{
										constant: false,
										id: 1277,
										name: "month",
										nodeType: "VariableDeclaration",
										scope: 1336,
										src: "10138:11:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										},
										typeName: {
											id: 1276,
											name: "uint8",
											nodeType: "ElementaryTypeName",
											src: "10138:5:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1282,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1280,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "10170:3:1",
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
										expression: {
											argumentTypes: null,
											id: 1278,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "10152:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 1279,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getMonth",
										nodeType: "MemberAccess",
										referencedDeclaration: 790,
										src: "10152:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint8_$",
											typeString: "function (uint256) pure external returns (uint8)"
										}
									},
									id: 1281,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10152:22:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10138:36:1"
							},
							{
								assignments: [
									1284
								],
								declarations: [
									{
										constant: false,
										id: 1284,
										name: "day",
										nodeType: "VariableDeclaration",
										scope: 1336,
										src: "10184:9:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										},
										typeName: {
											id: 1283,
											name: "uint8",
											nodeType: "ElementaryTypeName",
											src: "10184:5:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1289,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1287,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "10212:3:1",
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
										expression: {
											argumentTypes: null,
											id: 1285,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "10196:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 1286,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getDay",
										nodeType: "MemberAccess",
										referencedDeclaration: 797,
										src: "10196:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint8_$",
											typeString: "function (uint256) pure external returns (uint8)"
										}
									},
									id: 1288,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10196:20:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10184:32:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1292,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1290,
										name: "rowMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1267,
										src: "10227:11:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										id: 1291,
										name: "year",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1270,
										src: "10242:4:1",
										typeDescriptions: {
											typeIdentifier: "t_uint16",
											typeString: "uint16"
										}
									},
									src: "10227:19:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1293,
								nodeType: "ExpressionStatement",
								src: "10227:19:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1300,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1294,
										name: "rowMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1267,
										src: "10256:11:1",
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
										id: 1299,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1296,
													name: "month",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1277,
													src: "10279:5:1",
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
												id: 1295,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "10271:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
											},
											id: 1297,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10271:14:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "3136",
											id: 1298,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10287:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_16_by_1",
												typeString: "int_const 16"
											},
											value: "16"
										},
										src: "10271:18:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "10256:33:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1301,
								nodeType: "ExpressionStatement",
								src: "10256:33:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1308,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1302,
										name: "rowMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1267,
										src: "10299:11:1",
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
										id: 1307,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1304,
													name: "day",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1284,
													src: "10322:3:1",
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
												id: 1303,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "10314:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
											},
											id: 1305,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10314:12:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "3234",
											id: 1306,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10328:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_24_by_1",
												typeString: "int_const 24"
											},
											value: "24"
										},
										src: "10314:16:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "10299:31:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1309,
								nodeType: "ExpressionStatement",
								src: "10299:31:1"
							},
							{
								assignments: [
									1311
								],
								declarations: [
									{
										constant: false,
										id: 1311,
										name: "createdDate",
										nodeType: "VariableDeclaration",
										scope: 1336,
										src: "10341:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes4",
											typeString: "bytes4"
										},
										typeName: {
											id: 1310,
											name: "bytes4",
											nodeType: "ElementaryTypeName",
											src: "10341:6:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes4",
												typeString: "bytes4"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1317,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1314,
													name: "rowMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1267,
													src: "10376:11:1",
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
												id: 1313,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "10369:6:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint32_$",
													typeString: "type(uint32)"
												},
												typeName: "uint32"
											},
											id: 1315,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10369:19:1",
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
										id: 1312,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "10362:6:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_bytes4_$",
											typeString: "type(bytes4)"
										},
										typeName: "bytes4"
									},
									id: 1316,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10362:27:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes4",
										typeString: "bytes4"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10341:48:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1325,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1318,
										name: "rowMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1267,
										src: "10400:11:1",
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
										id: 1324,
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
														id: 1320,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3257
														],
														referencedDeclaration: 3257,
														src: "10423:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1321,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "10423:12:1",
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
												id: 1319,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "10415:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
											},
											id: 1322,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10415:21:1",
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
											id: 1323,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "10438:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_32_by_1",
												typeString: "int_const 32"
											},
											value: "32"
										},
										src: "10415:25:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "10400:40:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1326,
								nodeType: "ExpressionStatement",
								src: "10400:40:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1330,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1249,
											src: "10475:10:1",
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
													id: 1332,
													name: "rowMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1267,
													src: "10495:11:1",
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
												id: 1331,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "10487:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1333,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10487:20:1",
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
											id: 1327,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "10451:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1329,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8109,
										src: "10451:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1334,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10451:57:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1335,
								nodeType: "ExpressionStatement",
								src: "10451:57:1"
							}
						]
					},
					documentation: "@dev we are essentially claiming this [id].[table] for the msg.sender, and setting the id createdDate",
					id: 1337,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_setRowOwner",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1254,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1249,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1337,
								src: "9907:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1248,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9907:7:1",
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
								id: 1251,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1337,
								src: "9927:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1250,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9927:7:1",
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
								id: 1253,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1337,
								src: "9939:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1252,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "9939:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "9906:50:1"
					},
					returnParameters: {
						id: 1255,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "9966:0:1"
					},
					scope: 2161,
					src: "9885:686:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1371,
						nodeType: "Block",
						src: "10897:184:1",
						statements: [
							{
								assignments: [
									1347
								],
								declarations: [
									{
										constant: false,
										id: 1347,
										name: "rowMetadata",
										nodeType: "VariableDeclaration",
										scope: 1371,
										src: "10908:19:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1346,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "10908:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1354,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1351,
													name: "idTableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1339,
													src: "10964:10:1",
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
													id: 1349,
													name: "database",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 833,
													src: "10938:8:1",
													typeDescriptions: {
														typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
														typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
													}
												},
												id: 1350,
												isConstant: false,
												isLValue: true,
												isPure: false,
												lValueRequested: false,
												memberName: "getBytes32ForKey",
												nodeType: "MemberAccess",
												referencedDeclaration: 7624,
												src: "10938:25:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
													typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
												}
											},
											id: 1352,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "10938:37:1",
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
										id: 1348,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "10930:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1353,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "10930:46:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "10908:68:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1361,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1355,
										name: "createdDate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1344,
										src: "10987:11:1",
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
														id: 1358,
														name: "rowMetadata",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1347,
														src: "11015:11:1",
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
													id: 1357,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "11008:6:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint32_$",
														typeString: "type(uint32)"
													},
													typeName: "uint32"
												},
												id: 1359,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "11008:19:1",
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
											id: 1356,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "11001:6:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_bytes4_$",
												typeString: "type(bytes4)"
											},
											typeName: "bytes4"
										},
										id: 1360,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "11001:27:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes4",
											typeString: "bytes4"
										}
									},
									src: "10987:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes4",
										typeString: "bytes4"
									}
								},
								id: 1362,
								nodeType: "ExpressionStatement",
								src: "10987:41:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1369,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1363,
										name: "rowOwner",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1342,
										src: "11038:8:1",
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
												id: 1367,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1365,
													name: "rowMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1347,
													src: "11057:11:1",
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
													id: 1366,
													isConstant: false,
													isLValue: false,
													isPure: true,
													kind: "number",
													lValueRequested: false,
													nodeType: "Literal",
													src: "11070:2:1",
													subdenomination: null,
													typeDescriptions: {
														typeIdentifier: "t_rational_32_by_1",
														typeString: "int_const 32"
													},
													value: "32"
												},
												src: "11057:15:1",
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
											id: 1364,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "11049:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_address_$",
												typeString: "type(address)"
											},
											typeName: "address"
										},
										id: 1368,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "11049:24:1",
										typeDescriptions: {
											typeIdentifier: "t_address_payable",
											typeString: "address payable"
										}
									},
									src: "11038:35:1",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								id: 1370,
								nodeType: "ExpressionStatement",
								src: "11038:35:1"
							}
						]
					},
					documentation: "Primarily to assist querying all ids belonging to an owner",
					id: 1372,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowOwner",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1340,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1339,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1372,
								src: "10822:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1338,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "10822:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "10821:20:1"
					},
					returnParameters: {
						id: 1345,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1342,
								name: "rowOwner",
								nodeType: "VariableDeclaration",
								scope: 1372,
								src: "10860:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1341,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "10860:7:1",
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
								id: 1344,
								name: "createdDate",
								nodeType: "VariableDeclaration",
								scope: 1372,
								src: "10878:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes4",
									typeString: "bytes4"
								},
								typeName: {
									id: 1343,
									name: "bytes4",
									nodeType: "ElementaryTypeName",
									src: "10878:6:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes4",
										typeString: "bytes4"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "10859:38:1"
					},
					scope: 2161,
					src: "10801:280:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1468,
						nodeType: "Block",
						src: "11182:1232:1",
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
												"arguments": [
													{
														argumentTypes: null,
														id: 1386,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1374,
														src: "11229:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1387,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1380,
														src: "11239:2:1",
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
														id: 1384,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 822,
														src: "11201:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1385,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsValueForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 6090,
													src: "11201:27:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
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
												src: "11201:41:1",
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
												id: 1389,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "11246:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "11201:49:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "696420646f65736e27742065786973742c2075736520494e53455254",
											id: 1391,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "11252:30:1",
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
										id: 1383,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "11193:7:1",
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
									src: "11193:90:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1393,
								nodeType: "ExpressionStatement",
								src: "11193:90:1"
							},
							{
								assignments: [
									1395,
									1397
								],
								declarations: [
									{
										constant: false,
										id: 1395,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1468,
										src: "11295:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1394,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "11295:7:1",
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
										id: 1397,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1468,
										src: "11315:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1396,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "11315:7:1",
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
								id: 1401,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1399,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1374,
											src: "11352:8:1",
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
										id: 1398,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1875,
										src: "11335:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1400,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11335:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "11294:67:1"
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
											id: 1405,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1403,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1395,
												src: "11444:10:1",
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
												id: 1404,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "11457:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "11444:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f74205550444154452073797374656d207461626c65",
											id: 1406,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "11460:28:1",
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
										id: 1402,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "11436:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1407,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "11436:53:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1408,
								nodeType: "ExpressionStatement",
								src: "11436:53:1"
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
											id: 1422,
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
												id: 1417,
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
													id: 1412,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1410,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1395,
														src: "11568:10:1",
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
														id: 1411,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "11581:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "11568:14:1",
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
													id: 1416,
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
															id: 1413,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4669,
															src: "11586:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1414,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "11586:9:1",
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
														id: 1415,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "11599:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "11586:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "11568:35:1",
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
												id: 1421,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1418,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1397,
													src: "11607:8:1",
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
														id: 1419,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3257
														],
														referencedDeclaration: 3257,
														src: "11619:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1420,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "11619:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "11607:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "11568:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e2055504441544520696e746f2074686973207461626c65",
											id: 1423,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "11633:48:1",
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
										id: 1409,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "11560:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
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
									src: "11560:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1425,
								nodeType: "ExpressionStatement",
								src: "11560:122:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1428,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1426,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1395,
										src: "11856:10:1",
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
										id: 1427,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "11870:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_2_by_1",
											typeString: "int_const 2"
										},
										value: "2"
									},
									src: "11856:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1467,
								nodeType: "IfStatement",
								src: "11852:556:1",
								trueBody: {
									id: 1466,
									nodeType: "Block",
									src: "11873:535:1",
									statements: [
										{
											assignments: [
												1430
											],
											declarations: [
												{
													constant: false,
													id: 1430,
													name: "rowMetaData",
													nodeType: "VariableDeclaration",
													scope: 1466,
													src: "11969:19:1",
													stateVariable: false,
													storageLocation: "default",
													typeDescriptions: {
														typeIdentifier: "t_bytes32",
														typeString: "bytes32"
													},
													typeName: {
														id: 1429,
														name: "bytes32",
														nodeType: "ElementaryTypeName",
														src: "11969:7:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													value: null,
													visibility: "internal"
												}
											],
											id: 1435,
											initialValue: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1433,
														name: "idTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1378,
														src: "12017:10:1",
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
														id: 1431,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "11991:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1432,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytes32ForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7624,
													src: "11991:25:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
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
												src: "11991:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											nodeType: "VariableDeclarationStatement",
											src: "11969:59:1"
										},
										{
											assignments: [
												1437
											],
											declarations: [
												{
													constant: false,
													id: 1437,
													name: "rowOwner",
													nodeType: "VariableDeclaration",
													scope: 1466,
													src: "12042:16:1",
													stateVariable: false,
													storageLocation: "default",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													},
													typeName: {
														id: 1436,
														name: "address",
														nodeType: "ElementaryTypeName",
														src: "12042:7:1",
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
											id: 1445,
											initialValue: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														commonType: {
															typeIdentifier: "t_uint256",
															typeString: "uint256"
														},
														id: 1443,
														isConstant: false,
														isLValue: false,
														isPure: false,
														lValueRequested: false,
														leftExpression: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	id: 1440,
																	name: "rowMetaData",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 1430,
																	src: "12077:11:1",
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
																id: 1439,
																isConstant: false,
																isLValue: false,
																isPure: true,
																lValueRequested: false,
																nodeType: "ElementaryTypeNameExpression",
																src: "12069:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_type$_t_uint256_$",
																	typeString: "type(uint256)"
																},
																typeName: "uint256"
															},
															id: 1441,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "typeConversion",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "12069:20:1",
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
															id: 1442,
															isConstant: false,
															isLValue: false,
															isPure: true,
															kind: "number",
															lValueRequested: false,
															nodeType: "Literal",
															src: "12091:2:1",
															subdenomination: null,
															typeDescriptions: {
																typeIdentifier: "t_rational_32_by_1",
																typeString: "int_const 32"
															},
															value: "32"
														},
														src: "12069:24:1",
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
													id: 1438,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "12061:7:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_address_$",
														typeString: "type(address)"
													},
													typeName: "address"
												},
												id: 1444,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "12061:33:1",
												typeDescriptions: {
													typeIdentifier: "t_address_payable",
													typeString: "address payable"
												}
											},
											nodeType: "VariableDeclarationStatement",
											src: "12042:52:1"
										},
										{
											condition: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_address",
													typeString: "address"
												},
												id: 1449,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1446,
													name: "rowOwner",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1437,
													src: "12180:8:1",
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
														id: 1447,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3257
														],
														referencedDeclaration: 3257,
														src: "12192:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
														}
													},
													id: 1448,
													isConstant: false,
													isLValue: false,
													isPure: false,
													kind: "functionCall",
													lValueRequested: false,
													names: [
													],
													nodeType: "FunctionCall",
													src: "12192:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "12180:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											falseBody: {
												id: 1464,
												nodeType: "Block",
												src: "12250:148:1",
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
																	id: 1460,
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
																		id: 1455,
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
																				id: 1452,
																				name: "isOwner",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																				],
																				referencedDeclaration: 4669,
																				src: "12276:7:1",
																				typeDescriptions: {
																					typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																					typeString: "function () view returns (bool)"
																				}
																			},
																			id: 1453,
																			isConstant: false,
																			isLValue: false,
																			isPure: false,
																			kind: "functionCall",
																			lValueRequested: false,
																			names: [
																			],
																			nodeType: "FunctionCall",
																			src: "12276:9:1",
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
																			id: 1454,
																			isConstant: false,
																			isLValue: false,
																			isPure: true,
																			kind: "bool",
																			lValueRequested: false,
																			nodeType: "Literal",
																			src: "12289:4:1",
																			subdenomination: null,
																			typeDescriptions: {
																				typeIdentifier: "t_bool",
																				typeString: "bool"
																			},
																			value: "true"
																		},
																		src: "12276:17:1",
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
																		id: 1459,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		lValueRequested: false,
																		leftExpression: {
																			argumentTypes: null,
																			id: 1456,
																			name: "delegate",
																			nodeType: "Identifier",
																			overloadedDeclarations: [
																			],
																			referencedDeclaration: 1397,
																			src: "12297:8:1",
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
																				id: 1457,
																				name: "_msgSender",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																					3257
																				],
																				referencedDeclaration: 3257,
																				src: "12309:10:1",
																				typeDescriptions: {
																					typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																					typeString: "function () view returns (address)"
																				}
																			},
																			id: 1458,
																			isConstant: false,
																			isLValue: false,
																			isPure: false,
																			kind: "functionCall",
																			lValueRequested: false,
																			names: [
																			],
																			nodeType: "FunctionCall",
																			src: "12309:12:1",
																			typeDescriptions: {
																				typeIdentifier: "t_address",
																				typeString: "address"
																			}
																		},
																		src: "12297:24:1",
																		typeDescriptions: {
																			typeIdentifier: "t_bool",
																			typeString: "bool"
																		}
																	},
																	src: "12276:45:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	}
																},
																{
																	argumentTypes: null,
																	hexValue: "4e6f7420726f774f776e6572206f72206f776e65722f64656c656761746520666f722055504441544520696e746f2074686973207461626c65",
																	id: 1461,
																	isConstant: false,
																	isLValue: false,
																	isPure: true,
																	kind: "string",
																	lValueRequested: false,
																	nodeType: "Literal",
																	src: "12323:59:1",
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
																id: 1451,
																name: "require",
																nodeType: "Identifier",
																overloadedDeclarations: [
																	10664,
																	10665
																],
																referencedDeclaration: 10665,
																src: "12268:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
																	typeString: "function (bool,string memory) pure"
																}
															},
															id: 1462,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "12268:115:1",
															typeDescriptions: {
																typeIdentifier: "t_tuple$__$",
																typeString: "tuple()"
															}
														},
														id: 1463,
														nodeType: "ExpressionStatement",
														src: "12268:115:1"
													}
												]
											},
											id: 1465,
											nodeType: "IfStatement",
											src: "12176:222:1",
											trueBody: {
												id: 1450,
												nodeType: "Block",
												src: "12205:39:1",
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
					id: 1469,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "updateCheck",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1381,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1374,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1469,
								src: "11108:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1373,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11108:7:1",
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
								id: 1376,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1469,
								src: "11126:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1375,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11126:7:1",
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
								id: 1378,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1469,
								src: "11141:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1377,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11141:7:1",
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
								id: 1380,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1469,
								src: "11161:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1379,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "11161:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "11107:65:1"
					},
					returnParameters: {
						id: 1382,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "11182:0:1"
					},
					scope: 2161,
					src: "11087:1327:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1524,
						nodeType: "Block",
						src: "12570:456:1",
						statements: [
							{
								assignments: [
									1483
								],
								declarations: [
									{
										constant: false,
										id: 1483,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1524,
										src: "12581:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1482,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "12581:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1488,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1485,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1473,
											src: "12611:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1486,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1471,
											src: "12618:8:1",
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
										id: 1484,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "12602:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1487,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12602:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "12581:46:1"
							},
							{
								assignments: [
									1490
								],
								declarations: [
									{
										constant: false,
										id: 1490,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1524,
										src: "12637:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1489,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "12637:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1495,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1492,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1475,
											src: "12672:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1493,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1483,
											src: "12682:10:1",
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
										id: 1491,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "12663:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1494,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12663:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "12637:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1497,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1471,
											src: "12716:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1498,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1473,
											src: "12726:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1499,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1483,
											src: "12733:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1500,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1477,
											src: "12745:2:1",
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
										id: 1496,
										name: "updateCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1469,
										src: "12704:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1501,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12704:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1502,
								nodeType: "ExpressionStatement",
								src: "12704:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1503,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2000,
										src: "12788:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1504,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12788:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1505,
								nodeType: "ExpressionStatement",
								src: "12788:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1509,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1490,
											src: "12875:15:1",
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
													id: 1511,
													name: "val",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1479,
													src: "12900:3:1",
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
												id: 1510,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "12892:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_bytes32_$",
													typeString: "type(bytes32)"
												},
												typeName: "bytes32"
											},
											id: 1512,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "12892:12:1",
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
											id: 1506,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "12851:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1508,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "setValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8109,
										src: "12851:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32,bytes32) returns (bool)"
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
									src: "12851:54:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1514,
								nodeType: "ExpressionStatement",
								src: "12851:54:1"
							},
							{
								eventCall: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1516,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1471,
											src: "12977:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1517,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1475,
											src: "12987:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1518,
											name: "val",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1479,
											src: "12997:3:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1519,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1477,
											src: "13002:2:1",
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
												id: 1520,
												name: "_msgSender",
												nodeType: "Identifier",
												overloadedDeclarations: [
													3257
												],
												referencedDeclaration: 3257,
												src: "13006:10:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 1521,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "13006:12:1",
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
										id: 1515,
										name: "InsertVal",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1092,
										src: "12967:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_event_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_address_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32,address)"
										}
									},
									id: 1522,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "12967:52:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1523,
								nodeType: "EmitStatement",
								src: "12962:57:1"
							}
						]
					},
					documentation: null,
					id: 1525,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "updateVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1480,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1471,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1525,
								src: "12449:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1470,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12449:7:1",
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
								id: 1473,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1525,
								src: "12475:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1472,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12475:7:1",
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
								id: 1475,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1525,
								src: "12498:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1474,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12498:7:1",
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
								id: 1477,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1525,
								src: "12525:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1476,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12525:7:1",
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
								id: 1479,
								name: "val",
								nodeType: "VariableDeclaration",
								scope: 1525,
								src: "12545:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1478,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "12545:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "12438:119:1"
					},
					returnParameters: {
						id: 1481,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "12570:0:1"
					},
					scope: 2161,
					src: "12420:606:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1619,
						nodeType: "Block",
						src: "13127:1126:1",
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
											id: 1543,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1539,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1527,
														src: "13174:8:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes32",
															typeString: "bytes32"
														}
													},
													{
														argumentTypes: null,
														id: 1540,
														name: "id",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1533,
														src: "13184:2:1",
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
														id: 1537,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 822,
														src: "13146:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1538,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsValueForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 6090,
													src: "13146:27:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
													}
												},
												id: 1541,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "13146:41:1",
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
												id: 1542,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "13191:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "13146:49:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "696420646f65736e2774206578697374",
											id: 1544,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "13197:18:1",
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
										id: 1536,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "13138:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1545,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13138:78:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1546,
								nodeType: "ExpressionStatement",
								src: "13138:78:1"
							},
							{
								assignments: [
									1548,
									1550
								],
								declarations: [
									{
										constant: false,
										id: 1548,
										name: "permission",
										nodeType: "VariableDeclaration",
										scope: 1619,
										src: "13228:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1547,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "13228:7:1",
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
										id: 1550,
										name: "delegate",
										nodeType: "VariableDeclaration",
										scope: 1619,
										src: "13248:16:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_address",
											typeString: "address"
										},
										typeName: {
											id: 1549,
											name: "address",
											nodeType: "ElementaryTypeName",
											src: "13248:7:1",
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
								id: 1554,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1552,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1527,
											src: "13285:8:1",
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
										id: 1551,
										name: "getTableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1875,
										src: "13268:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_bytes32_$returns$_t_uint256_$_t_address_$",
											typeString: "function (bytes32) view returns (uint256,address)"
										}
									},
									id: 1553,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13268:26:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_address_$",
										typeString: "tuple(uint256,address)"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "13227:67:1"
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
											id: 1558,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1556,
												name: "permission",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1548,
												src: "13377:10:1",
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
												id: 1557,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "13390:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "13377:14:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65",
											id: 1559,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "13393:33:1",
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
										id: 1555,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "13369:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1560,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13369:58:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1561,
								nodeType: "ExpressionStatement",
								src: "13369:58:1"
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
											id: 1575,
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
												id: 1570,
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
													id: 1565,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1563,
														name: "permission",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1548,
														src: "13506:10:1",
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
														id: 1564,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "13519:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_1_by_1",
															typeString: "int_const 1"
														},
														value: "1"
													},
													src: "13506:14:1",
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
													id: 1569,
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
															id: 1566,
															name: "isOwner",
															nodeType: "Identifier",
															overloadedDeclarations: [
															],
															referencedDeclaration: 4669,
															src: "13524:7:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
																typeString: "function () view returns (bool)"
															}
														},
														id: 1567,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "13524:9:1",
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
														id: 1568,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "bool",
														lValueRequested: false,
														nodeType: "Literal",
														src: "13537:4:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_bool",
															typeString: "bool"
														},
														value: "true"
													},
													src: "13524:17:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "13506:35:1",
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
												id: 1574,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1571,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1550,
													src: "13545:8:1",
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
														id: 1572,
														name: "_msgSender",
														nodeType: "Identifier",
														overloadedDeclarations: [
															3257
														],
														referencedDeclaration: 3257,
														src: "13557:10:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
															typeString: "function () view returns (address)"
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
													src: "13557:12:1",
													typeDescriptions: {
														typeIdentifier: "t_address",
														typeString: "address"
													}
												},
												src: "13545:24:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											src: "13506:63:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "4f6e6c79206f776e65722f64656c65676174652063616e2044454c4554452066726f6d2074686973207461626c65",
											id: 1576,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "13571:48:1",
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
										id: 1562,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "13498:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1577,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "13498:122:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1578,
								nodeType: "ExpressionStatement",
								src: "13498:122:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1581,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1579,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1548,
										src: "13794:10:1",
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
										id: 1580,
										isConstant: false,
										isLValue: false,
										isPure: true,
										kind: "number",
										lValueRequested: false,
										nodeType: "Literal",
										src: "13808:1:1",
										subdenomination: null,
										typeDescriptions: {
											typeIdentifier: "t_rational_2_by_1",
											typeString: "int_const 2"
										},
										value: "2"
									},
									src: "13794:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1618,
								nodeType: "IfStatement",
								src: "13790:457:1",
								trueBody: {
									id: 1617,
									nodeType: "Block",
									src: "13811:436:1",
									statements: [
										{
											condition: {
												argumentTypes: null,
												commonType: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												id: 1588,
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
														id: 1582,
														name: "isOwner",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 4669,
														src: "13829:7:1",
														typeDescriptions: {
															typeIdentifier: "t_function_internal_view$__$returns$_t_bool_$",
															typeString: "function () view returns (bool)"
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
													src: "13829:9:1",
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
													id: 1587,
													isConstant: false,
													isLValue: false,
													isPure: false,
													lValueRequested: false,
													leftExpression: {
														argumentTypes: null,
														id: 1584,
														name: "delegate",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1550,
														src: "13842:8:1",
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
															id: 1585,
															name: "_msgSender",
															nodeType: "Identifier",
															overloadedDeclarations: [
																3257
															],
															referencedDeclaration: 3257,
															src: "13854:10:1",
															typeDescriptions: {
																typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																typeString: "function () view returns (address)"
															}
														},
														id: 1586,
														isConstant: false,
														isLValue: false,
														isPure: false,
														kind: "functionCall",
														lValueRequested: false,
														names: [
														],
														nodeType: "FunctionCall",
														src: "13854:12:1",
														typeDescriptions: {
															typeIdentifier: "t_address",
															typeString: "address"
														}
													},
													src: "13842:24:1",
													typeDescriptions: {
														typeIdentifier: "t_bool",
														typeString: "bool"
													}
												},
												src: "13829:37:1",
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												}
											},
											falseBody: {
												id: 1615,
												nodeType: "Block",
												src: "13912:325:1",
												statements: [
													{
														assignments: [
															1591
														],
														declarations: [
															{
																constant: false,
																id: 1591,
																name: "rowMetaData",
																nodeType: "VariableDeclaration",
																scope: 1615,
																src: "14015:19:1",
																stateVariable: false,
																storageLocation: "default",
																typeDescriptions: {
																	typeIdentifier: "t_bytes32",
																	typeString: "bytes32"
																},
																typeName: {
																	id: 1590,
																	name: "bytes32",
																	nodeType: "ElementaryTypeName",
																	src: "14015:7:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bytes32",
																		typeString: "bytes32"
																	}
																},
																value: null,
																visibility: "internal"
															}
														],
														id: 1596,
														initialValue: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	id: 1594,
																	name: "idTableKey",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 1529,
																	src: "14063:10:1",
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
																	id: 1592,
																	name: "database",
																	nodeType: "Identifier",
																	overloadedDeclarations: [
																	],
																	referencedDeclaration: 833,
																	src: "14037:8:1",
																	typeDescriptions: {
																		typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
																		typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
																	}
																},
																id: 1593,
																isConstant: false,
																isLValue: true,
																isPure: false,
																lValueRequested: false,
																memberName: "getBytes32ForKey",
																nodeType: "MemberAccess",
																referencedDeclaration: 7624,
																src: "14037:25:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
																	typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
																}
															},
															id: 1595,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "14037:37:1",
															typeDescriptions: {
																typeIdentifier: "t_bytes32",
																typeString: "bytes32"
															}
														},
														nodeType: "VariableDeclarationStatement",
														src: "14015:59:1"
													},
													{
														assignments: [
															1598
														],
														declarations: [
															{
																constant: false,
																id: 1598,
																name: "rowOwner",
																nodeType: "VariableDeclaration",
																scope: 1615,
																src: "14092:16:1",
																stateVariable: false,
																storageLocation: "default",
																typeDescriptions: {
																	typeIdentifier: "t_address",
																	typeString: "address"
																},
																typeName: {
																	id: 1597,
																	name: "address",
																	nodeType: "ElementaryTypeName",
																	src: "14092:7:1",
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
														id: 1606,
														initialValue: {
															argumentTypes: null,
															"arguments": [
																{
																	argumentTypes: null,
																	commonType: {
																		typeIdentifier: "t_uint256",
																		typeString: "uint256"
																	},
																	id: 1604,
																	isConstant: false,
																	isLValue: false,
																	isPure: false,
																	lValueRequested: false,
																	leftExpression: {
																		argumentTypes: null,
																		"arguments": [
																			{
																				argumentTypes: null,
																				id: 1601,
																				name: "rowMetaData",
																				nodeType: "Identifier",
																				overloadedDeclarations: [
																				],
																				referencedDeclaration: 1591,
																				src: "14127:11:1",
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
																			id: 1600,
																			isConstant: false,
																			isLValue: false,
																			isPure: true,
																			lValueRequested: false,
																			nodeType: "ElementaryTypeNameExpression",
																			src: "14119:7:1",
																			typeDescriptions: {
																				typeIdentifier: "t_type$_t_uint256_$",
																				typeString: "type(uint256)"
																			},
																			typeName: "uint256"
																		},
																		id: 1602,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		kind: "typeConversion",
																		lValueRequested: false,
																		names: [
																		],
																		nodeType: "FunctionCall",
																		src: "14119:20:1",
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
																		id: 1603,
																		isConstant: false,
																		isLValue: false,
																		isPure: true,
																		kind: "number",
																		lValueRequested: false,
																		nodeType: "Literal",
																		src: "14141:2:1",
																		subdenomination: null,
																		typeDescriptions: {
																			typeIdentifier: "t_rational_32_by_1",
																			typeString: "int_const 32"
																		},
																		value: "32"
																	},
																	src: "14119:24:1",
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
																id: 1599,
																isConstant: false,
																isLValue: false,
																isPure: true,
																lValueRequested: false,
																nodeType: "ElementaryTypeNameExpression",
																src: "14111:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_type$_t_address_$",
																	typeString: "type(address)"
																},
																typeName: "address"
															},
															id: 1605,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "typeConversion",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "14111:33:1",
															typeDescriptions: {
																typeIdentifier: "t_address_payable",
																typeString: "address payable"
															}
														},
														nodeType: "VariableDeclarationStatement",
														src: "14092:52:1"
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
																	id: 1611,
																	isConstant: false,
																	isLValue: false,
																	isPure: false,
																	lValueRequested: false,
																	leftExpression: {
																		argumentTypes: null,
																		id: 1608,
																		name: "rowOwner",
																		nodeType: "Identifier",
																		overloadedDeclarations: [
																		],
																		referencedDeclaration: 1598,
																		src: "14170:8:1",
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
																			id: 1609,
																			name: "_msgSender",
																			nodeType: "Identifier",
																			overloadedDeclarations: [
																				3257
																			],
																			referencedDeclaration: 3257,
																			src: "14182:10:1",
																			typeDescriptions: {
																				typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
																				typeString: "function () view returns (address)"
																			}
																		},
																		id: 1610,
																		isConstant: false,
																		isLValue: false,
																		isPure: false,
																		kind: "functionCall",
																		lValueRequested: false,
																		names: [
																		],
																		nodeType: "FunctionCall",
																		src: "14182:12:1",
																		typeDescriptions: {
																			typeIdentifier: "t_address",
																			typeString: "address"
																		}
																	},
																	src: "14170:24:1",
																	typeDescriptions: {
																		typeIdentifier: "t_bool",
																		typeString: "bool"
																	}
																},
																{
																	argumentTypes: null,
																	hexValue: "53656e646572206e6f74206f776e6572206f6620726f77",
																	id: 1612,
																	isConstant: false,
																	isLValue: false,
																	isPure: true,
																	kind: "string",
																	lValueRequested: false,
																	nodeType: "Literal",
																	src: "14196:25:1",
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
																id: 1607,
																name: "require",
																nodeType: "Identifier",
																overloadedDeclarations: [
																	10664,
																	10665
																],
																referencedDeclaration: 10665,
																src: "14162:7:1",
																typeDescriptions: {
																	typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
																	typeString: "function (bool,string memory) pure"
																}
															},
															id: 1613,
															isConstant: false,
															isLValue: false,
															isPure: false,
															kind: "functionCall",
															lValueRequested: false,
															names: [
															],
															nodeType: "FunctionCall",
															src: "14162:60:1",
															typeDescriptions: {
																typeIdentifier: "t_tuple$__$",
																typeString: "tuple()"
															}
														},
														id: 1614,
														nodeType: "ExpressionStatement",
														src: "14162:60:1"
													}
												]
											},
											id: 1616,
											nodeType: "IfStatement",
											src: "13825:412:1",
											trueBody: {
												id: 1589,
												nodeType: "Block",
												src: "13867:39:1",
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
					id: 1620,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteCheck",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1534,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1527,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1620,
								src: "13053:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1526,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13053:7:1",
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
								id: 1529,
								name: "idTableKey",
								nodeType: "VariableDeclaration",
								scope: 1620,
								src: "13071:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1528,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13071:7:1",
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
								id: 1531,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1620,
								src: "13091:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1530,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13091:7:1",
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
								id: 1533,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1620,
								src: "13106:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1532,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "13106:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "13052:65:1"
					},
					returnParameters: {
						id: 1535,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "13127:0:1"
					},
					scope: 2161,
					src: "13032:1221:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1669,
						nodeType: "Block",
						src: "14552:1063:1",
						statements: [
							{
								assignments: [
									1632
								],
								declarations: [
									{
										constant: false,
										id: 1632,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1669,
										src: "14563:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1631,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "14563:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1637,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1634,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1624,
											src: "14593:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1635,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1622,
											src: "14600:8:1",
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
										id: 1633,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "14584:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1636,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14584:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "14563:46:1"
							},
							{
								assignments: [
									1639
								],
								declarations: [
									{
										constant: false,
										id: 1639,
										name: "fieldIdTableKey",
										nodeType: "VariableDeclaration",
										scope: 1669,
										src: "14619:23:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1638,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "14619:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1644,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1641,
											name: "fieldKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1626,
											src: "14654:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1642,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1632,
											src: "14664:10:1",
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
										id: 1640,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "14645:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1643,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14645:30:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "14619:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1646,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1622,
											src: "14698:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1647,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1632,
											src: "14708:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1648,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1624,
											src: "14720:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1649,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1628,
											src: "14727:2:1",
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
										id: 1645,
										name: "deleteCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1620,
										src: "14686:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1650,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14686:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1651,
								nodeType: "ExpressionStatement",
								src: "14686:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1652,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2000,
										src: "14770:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1653,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14770:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1654,
								nodeType: "ExpressionStatement",
								src: "14770:20:1"
							},
							{
								assignments: [
									1656
								],
								declarations: [
									{
										constant: false,
										id: 1656,
										name: "removed",
										nodeType: "VariableDeclaration",
										scope: 1669,
										src: "14827:12:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bool",
											typeString: "bool"
										},
										typeName: {
											id: 1655,
											name: "bool",
											nodeType: "ElementaryTypeName",
											src: "14827:4:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1661,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1659,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1639,
											src: "14861:15:1",
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
											id: 1657,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "14842:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1658,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 8600,
										src: "14842:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) returns (bool)"
										}
									},
									id: 1660,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14842:35:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "14827:50:1"
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
											id: 1665,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												id: 1663,
												name: "removed",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1656,
												src: "14896:7:1",
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
												id: 1664,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "14907:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "14896:15:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "6572726f722072656d6f76696e67206b6579",
											id: 1666,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "14913:20:1",
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
										id: 1662,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "14888:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1667,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "14888:46:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1668,
								nodeType: "ExpressionStatement",
								src: "14888:46:1"
							}
						]
					},
					documentation: "@dev TODO: add modifier checks based on update\n     * TODO: this needs to properly remove the row when there are multiple ids\n     ",
					id: 1670,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteVal",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1629,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1622,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1670,
								src: "14451:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1621,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "14451:7:1",
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
								id: 1624,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1670,
								src: "14477:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1623,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "14477:7:1",
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
								id: 1626,
								name: "fieldKey",
								nodeType: "VariableDeclaration",
								scope: 1670,
								src: "14500:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1625,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "14500:7:1",
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
								id: 1628,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1670,
								src: "14527:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1627,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "14527:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "14440:104:1"
					},
					returnParameters: {
						id: 1630,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "14552:0:1"
					},
					scope: 2161,
					src: "14422:1193:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1703,
						nodeType: "Block",
						src: "15997:254:1",
						statements: [
							{
								assignments: [
									1680
								],
								declarations: [
									{
										constant: false,
										id: 1680,
										name: "idTableKey",
										nodeType: "VariableDeclaration",
										scope: 1703,
										src: "16008:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1679,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "16008:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1685,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1682,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1674,
											src: "16038:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1683,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1672,
											src: "16045:8:1",
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
										id: 1681,
										name: "namehash",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1832,
										src: "16029:8:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$_t_bytes32_$_t_bytes32_$returns$_t_bytes32_$",
											typeString: "function (bytes32,bytes32) pure returns (bytes32)"
										}
									},
									id: 1684,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16029:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "16008:46:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1687,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1672,
											src: "16077:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1688,
											name: "idTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1680,
											src: "16087:10:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1689,
											name: "idKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1674,
											src: "16099:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1690,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1676,
											src: "16106:2:1",
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
										id: 1686,
										name: "deleteCheck",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1620,
										src: "16065:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_bytes32_$_t_bytes32_$_t_bytes32_$_t_bytes32_$returns$__$",
											typeString: "function (bytes32,bytes32,bytes32,bytes32)"
										}
									},
									id: 1691,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16065:44:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1692,
								nodeType: "ExpressionStatement",
								src: "16065:44:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1693,
										name: "increaseGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2000,
										src: "16149:18:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$__$returns$__$",
											typeString: "function ()"
										}
									},
									id: 1694,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16149:20:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1695,
								nodeType: "ExpressionStatement",
								src: "16149:20:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1699,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1672,
											src: "16231:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1700,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1676,
											src: "16241:2:1",
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
											id: 1696,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "16205:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1698,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "removeValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6061,
										src: "16205:25:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_nonpayable$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) returns (bool)"
										}
									},
									id: 1701,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "16205:39:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								id: 1702,
								nodeType: "ExpressionStatement",
								src: "16205:39:1"
							}
						]
					},
					documentation: null,
					id: 1704,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "deleteRow",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1677,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1672,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1704,
								src: "15923:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1671,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15923:7:1",
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
								id: 1674,
								name: "idKey",
								nodeType: "VariableDeclaration",
								scope: 1704,
								src: "15949:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1673,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15949:7:1",
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
								id: 1676,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1704,
								src: "15972:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1675,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "15972:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "15912:77:1"
					},
					returnParameters: {
						id: 1678,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "15997:0:1"
					},
					scope: 2161,
					src: "15894:357:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1716,
						nodeType: "Block",
						src: "17640:49:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1713,
											name: "key",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1706,
											src: "17678:3:1",
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
											id: 1711,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "17657:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1712,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7451,
										src: "17657:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1714,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17657:25:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 1710,
								id: 1715,
								nodeType: "Return",
								src: "17650:32:1"
							}
						]
					},
					documentation: "@dev Table actual insert call, NOTE this doesn't work on testnet currently due to a stack size issue,\n     but it can work with a paid transaction I guess",
					id: 1717,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "checkDataKey",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1707,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1706,
								name: "key",
								nodeType: "VariableDeclaration",
								scope: 1717,
								src: "17598:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1705,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17598:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17597:13:1"
					},
					returnParameters: {
						id: 1710,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1709,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1717,
								src: "17634:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 1708,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "17634:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17633:6:1"
					},
					scope: 2161,
					src: "17576:113:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1740,
						nodeType: "Block",
						src: "17899:182:1",
						statements: [
							{
								condition: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1726,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1719,
											src: "17935:15:1",
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
											id: 1724,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "17914:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1725,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7451,
										src: "17914:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1727,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "17914:37:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: {
									id: 1738,
									nodeType: "Block",
									src: "18033:42:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "30",
														id: 1735,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "18062:1:1",
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
													id: 1734,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "18054:7:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_bytes32_$",
														typeString: "type(bytes32)"
													},
													typeName: "bytes32"
												},
												id: 1736,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "18054:10:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											functionReturnParameters: 1723,
											id: 1737,
											nodeType: "Return",
											src: "18047:17:1"
										}
									]
								},
								id: 1739,
								nodeType: "IfStatement",
								src: "17910:165:1",
								trueBody: {
									id: 1733,
									nodeType: "Block",
									src: "17953:74:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1730,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1719,
														src: "18000:15:1",
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
														id: 1728,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "17974:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1729,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytes32ForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7624,
													src: "17974:25:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes32_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes32)"
													}
												},
												id: 1731,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "17974:42:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes32",
													typeString: "bytes32"
												}
											},
											functionReturnParameters: 1723,
											id: 1732,
											nodeType: "Return",
											src: "17967:49:1"
										}
									]
								}
							}
						]
					},
					documentation: "@dev all data is public, so no need for security checks, we leave the data type handling to the client",
					id: 1741,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowValue",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1720,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1719,
								name: "fieldIdTableKey",
								nodeType: "VariableDeclaration",
								scope: 1741,
								src: "17842:23:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1718,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "17842:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17841:25:1"
					},
					returnParameters: {
						id: 1723,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1722,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1741,
								src: "17890:7:1",
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
									src: "17890:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "17889:9:1"
					},
					scope: 2161,
					src: "17821:260:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1765,
						nodeType: "Block",
						src: "18173:182:1",
						statements: [
							{
								condition: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1750,
											name: "fieldIdTableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1743,
											src: "18209:15:1",
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
											id: 1748,
											name: "database",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 833,
											src: "18188:8:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
												typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
											}
										},
										id: 1749,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 7451,
										src: "18188:20:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
											typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bool)"
										}
									},
									id: 1751,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18188:37:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: {
									id: 1763,
									nodeType: "Block",
									src: "18305:44:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "30",
														id: 1760,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "18336:1:1",
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
													id: 1759,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "NewExpression",
													src: "18326:9:1",
													typeDescriptions: {
														typeIdentifier: "t_function_objectcreation_pure$_t_uint256_$returns$_t_bytes_memory_$",
														typeString: "function (uint256) pure returns (bytes memory)"
													},
													typeName: {
														id: 1758,
														name: "bytes",
														nodeType: "ElementaryTypeName",
														src: "18330:5:1",
														typeDescriptions: {
															typeIdentifier: "t_bytes_storage_ptr",
															typeString: "bytes"
														}
													}
												},
												id: 1761,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "18326:12:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes_memory",
													typeString: "bytes memory"
												}
											},
											functionReturnParameters: 1747,
											id: 1762,
											nodeType: "Return",
											src: "18319:19:1"
										}
									]
								},
								id: 1764,
								nodeType: "IfStatement",
								src: "18184:165:1",
								trueBody: {
									id: 1757,
									nodeType: "Block",
									src: "18227:72:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1754,
														name: "fieldIdTableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1743,
														src: "18272:15:1",
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
														id: 1752,
														name: "database",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 833,
														src: "18248:8:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_PolymorphicDictionary_$7143_storage",
															typeString: "struct PolymorphicDictionaryLib.PolymorphicDictionary storage ref"
														}
													},
													id: 1753,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "getBytesForKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 7716,
													src: "18248:23:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$_t_bytes32_$returns$_t_bytes_memory_ptr_$bound_to$_t_struct$_PolymorphicDictionary_$7143_storage_ptr_$",
														typeString: "function (struct PolymorphicDictionaryLib.PolymorphicDictionary storage pointer,bytes32) view returns (bytes memory)"
													}
												},
												id: 1755,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "18248:40:1",
												typeDescriptions: {
													typeIdentifier: "t_bytes_memory_ptr",
													typeString: "bytes memory"
												}
											},
											functionReturnParameters: 1747,
											id: 1756,
											nodeType: "Return",
											src: "18241:47:1"
										}
									]
								}
							}
						]
					},
					documentation: null,
					id: 1766,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRowValueVar",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1744,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1743,
								name: "fieldIdTableKey",
								nodeType: "VariableDeclaration",
								scope: 1766,
								src: "18111:23:1",
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
									src: "18111:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18110:25:1"
					},
					returnParameters: {
						id: 1747,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1746,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1766,
								src: "18159:12:1",
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
									src: "18159:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18158:14:1"
					},
					scope: 2161,
					src: "18087:268:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1789,
						nodeType: "Block",
						src: "18643:136:1",
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
											id: 1780,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														id: 1777,
														name: "tableKey",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1768,
														src: "18682:8:1",
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
														id: 1775,
														name: "tableId",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 822,
														src: "18662:7:1",
														typeDescriptions: {
															typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
															typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
														}
													},
													id: 1776,
													isConstant: false,
													isLValue: true,
													isPure: false,
													lValueRequested: false,
													memberName: "containsKey",
													nodeType: "MemberAccess",
													referencedDeclaration: 5935,
													src: "18662:19:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
														typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) view returns (bool)"
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
												src: "18662:29:1",
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
												id: 1779,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "bool",
												lValueRequested: false,
												nodeType: "Literal",
												src: "18695:4:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_bool",
													typeString: "bool"
												},
												value: "true"
											},
											src: "18662:37:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "7461626c65206e6f742063726561746564",
											id: 1781,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "18701:19:1",
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
										id: 1774,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "18654:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1782,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18654:67:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1783,
								nodeType: "ExpressionStatement",
								src: "18654:67:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1786,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1768,
											src: "18763:8:1",
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
											id: 1784,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "18739:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1785,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "enumerateForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6144,
										src: "18739:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$returns$_t_array$_t_bytes32_$dyn_memory_ptr_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32) view returns (bytes32[] memory)"
										}
									},
									id: 1787,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18739:33:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
										typeString: "bytes32[] memory"
									}
								},
								functionReturnParameters: 1773,
								id: 1788,
								nodeType: "Return",
								src: "18732:40:1"
							}
						]
					},
					documentation: "@dev Warning this produces an Error: overflow (operation=\"setValue\", fault=\"overflow\", details=\"Number can only safely store up to 53 bits\")\n     if the table doesn't exist",
					id: 1790,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTableIds",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1769,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1768,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1790,
								src: "18585:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1767,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18585:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18584:18:1"
					},
					returnParameters: {
						id: 1773,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1772,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1790,
								src: "18626:16:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_array$_t_bytes32_$dyn_memory_ptr",
									typeString: "bytes32[]"
								},
								typeName: {
									baseType: {
										id: 1770,
										name: "bytes32",
										nodeType: "ElementaryTypeName",
										src: "18626:7:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									id: 1771,
									length: null,
									nodeType: "ArrayTypeName",
									src: "18626:9:1",
									typeDescriptions: {
										typeIdentifier: "t_array$_t_bytes32_$dyn_storage_ptr",
										typeString: "bytes32[]"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18625:18:1"
					},
					scope: 2161,
					src: "18564:215:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1805,
						nodeType: "Block",
						src: "18865:65:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1801,
											name: "tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1792,
											src: "18910:8:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										{
											argumentTypes: null,
											id: 1802,
											name: "id",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1794,
											src: "18920:2:1",
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
											id: 1799,
											name: "tableId",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 822,
											src: "18882:7:1",
											typeDescriptions: {
												typeIdentifier: "t_struct$_Bytes32SetDictionary_$5903_storage",
												typeString: "struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage ref"
											}
										},
										id: 1800,
										isConstant: false,
										isLValue: true,
										isPure: false,
										lValueRequested: false,
										memberName: "containsValueForKey",
										nodeType: "MemberAccess",
										referencedDeclaration: 6090,
										src: "18882:27:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$_t_bytes32_$_t_bytes32_$returns$_t_bool_$bound_to$_t_struct$_Bytes32SetDictionary_$5903_storage_ptr_$",
											typeString: "function (struct Bytes32SetDictionaryLib.Bytes32SetDictionary storage pointer,bytes32,bytes32) view returns (bool)"
										}
									},
									id: 1803,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "18882:41:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								functionReturnParameters: 1798,
								id: 1804,
								nodeType: "Return",
								src: "18875:48:1"
							}
						]
					},
					documentation: null,
					id: 1806,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getIdExists",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1795,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1792,
								name: "tableKey",
								nodeType: "VariableDeclaration",
								scope: 1806,
								src: "18806:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1791,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18806:7:1",
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
								id: 1794,
								name: "id",
								nodeType: "VariableDeclaration",
								scope: 1806,
								src: "18824:10:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1793,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "18824:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18805:30:1"
					},
					returnParameters: {
						id: 1798,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1797,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1806,
								src: "18859:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 1796,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "18859:4:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "18858:6:1"
					},
					scope: 2161,
					src: "18785:145:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1831,
						nodeType: "Block",
						src: "19225:237:1",
						statements: [
							{
								assignments: [
									1816
								],
								declarations: [
									{
										constant: false,
										id: 1816,
										name: "concat",
										nodeType: "VariableDeclaration",
										scope: 1831,
										src: "19235:19:1",
										stateVariable: false,
										storageLocation: "memory",
										typeDescriptions: {
											typeIdentifier: "t_bytes_memory_ptr",
											typeString: "bytes"
										},
										typeName: {
											id: 1815,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "19235:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1821,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											hexValue: "3634",
											id: 1819,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "19267:2:1",
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
										id: 1818,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "NewExpression",
										src: "19257:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_objectcreation_pure$_t_uint256_$returns$_t_bytes_memory_$",
											typeString: "function (uint256) pure returns (bytes memory)"
										},
										typeName: {
											id: 1817,
											name: "bytes",
											nodeType: "ElementaryTypeName",
											src: "19261:5:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes_storage_ptr",
												typeString: "bytes"
											}
										}
									},
									id: 1820,
									isConstant: false,
									isLValue: false,
									isPure: true,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "19257:13:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_memory",
										typeString: "bytes memory"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "19235:35:1"
							},
							{
								externalReferences: [
									{
										subKey: {
											declaration: 1808,
											isOffset: false,
											isSlot: false,
											src: "19328:6:1",
											valueSize: 1
										}
									},
									{
										concat: {
											declaration: 1816,
											isOffset: false,
											isSlot: false,
											src: "19315:6:1",
											valueSize: 1
										}
									},
									{
										base: {
											declaration: 1810,
											isOffset: false,
											isSlot: false,
											src: "19372:4:1",
											valueSize: 1
										}
									},
									{
										concat: {
											declaration: 1816,
											isOffset: false,
											isSlot: false,
											src: "19359:6:1",
											valueSize: 1
										}
									}
								],
								id: 1822,
								nodeType: "InlineAssembly",
								operations: "{\n    mstore(add(concat, 64), subKey)\n    mstore(add(concat, 32), base)\n}",
								src: "19281:123:1"
							},
							{
								assignments: [
									1824
								],
								declarations: [
									{
										constant: false,
										id: 1824,
										name: "result",
										nodeType: "VariableDeclaration",
										scope: 1831,
										src: "19397:14:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1823,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "19397:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1828,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 1826,
											name: "concat",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1816,
											src: "19424:6:1",
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
										id: 1825,
										name: "keccak256",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 10655,
										src: "19414:9:1",
										typeDescriptions: {
											typeIdentifier: "t_function_keccak256_pure$_t_bytes_memory_ptr_$returns$_t_bytes32_$",
											typeString: "function (bytes memory) pure returns (bytes32)"
										}
									},
									id: 1827,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "19414:17:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "19397:34:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1829,
									name: "result",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 1824,
									src: "19449:6:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								functionReturnParameters: 1814,
								id: 1830,
								nodeType: "Return",
								src: "19442:13:1"
							}
						]
					},
					documentation: null,
					id: 1832,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "namehash",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1811,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1808,
								name: "subKey",
								nodeType: "VariableDeclaration",
								scope: 1832,
								src: "19163:14:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1807,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "19163:7:1",
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
								id: 1810,
								name: "base",
								nodeType: "VariableDeclaration",
								scope: 1832,
								src: "19179:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1809,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "19179:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "19162:30:1"
					},
					returnParameters: {
						id: 1814,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1813,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1832,
								src: "19216:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1812,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "19216:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "19215:9:1"
					},
					scope: 2161,
					src: "19145:317:1",
					stateMutability: "pure",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 1874,
						nodeType: "Block",
						src: "19700:231:1",
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
											id: 1846,
											isConstant: false,
											isLValue: false,
											isPure: false,
											lValueRequested: false,
											leftExpression: {
												argumentTypes: null,
												baseExpression: {
													argumentTypes: null,
													id: 1842,
													name: "_table",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 820,
													src: "19718:6:1",
													typeDescriptions: {
														typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
														typeString: "mapping(bytes32 => bytes32)"
													}
												},
												id: 1844,
												indexExpression: {
													argumentTypes: null,
													id: 1843,
													name: "_tableKey",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1834,
													src: "19725:9:1",
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
												src: "19718:17:1",
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
												id: 1845,
												isConstant: false,
												isLValue: false,
												isPure: true,
												kind: "number",
												lValueRequested: false,
												nodeType: "Literal",
												src: "19738:1:1",
												subdenomination: null,
												typeDescriptions: {
													typeIdentifier: "t_rational_0_by_1",
													typeString: "int_const 0"
												},
												value: "0"
											},
											src: "19718:21:1",
											typeDescriptions: {
												typeIdentifier: "t_bool",
												typeString: "bool"
											}
										},
										{
											argumentTypes: null,
											hexValue: "7461626c6520646f6573206e6f74206578697374",
											id: 1847,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "string",
											lValueRequested: false,
											nodeType: "Literal",
											src: "19741:22:1",
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
										id: 1841,
										name: "require",
										nodeType: "Identifier",
										overloadedDeclarations: [
											10664,
											10665
										],
										referencedDeclaration: 10665,
										src: "19710:7:1",
										typeDescriptions: {
											typeIdentifier: "t_function_require_pure$_t_bool_$_t_string_memory_ptr_$returns$__$",
											typeString: "function (bool,string memory) pure"
										}
									},
									id: 1848,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "19710:54:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 1849,
								nodeType: "ExpressionStatement",
								src: "19710:54:1"
							},
							{
								assignments: [
									1851
								],
								declarations: [
									{
										constant: false,
										id: 1851,
										name: "tableMetadata",
										nodeType: "VariableDeclaration",
										scope: 1874,
										src: "19775:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1850,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "19775:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1857,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											baseExpression: {
												argumentTypes: null,
												id: 1853,
												name: "_table",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 820,
												src: "19807:6:1",
												typeDescriptions: {
													typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
													typeString: "mapping(bytes32 => bytes32)"
												}
											},
											id: 1855,
											indexExpression: {
												argumentTypes: null,
												id: 1854,
												name: "_tableKey",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1834,
												src: "19814:9:1",
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
											src: "19807:17:1",
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
										id: 1852,
										isConstant: false,
										isLValue: false,
										isPure: true,
										lValueRequested: false,
										nodeType: "ElementaryTypeNameExpression",
										src: "19799:7:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_uint256_$",
											typeString: "type(uint256)"
										},
										typeName: "uint256"
									},
									id: 1856,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "19799:26:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "19775:50:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1864,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1858,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1837,
										src: "19836:10:1",
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
														id: 1861,
														name: "tableMetadata",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 1851,
														src: "19863:13:1",
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
													id: 1860,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													nodeType: "ElementaryTypeNameExpression",
													src: "19857:5:1",
													typeDescriptions: {
														typeIdentifier: "t_type$_t_uint8_$",
														typeString: "type(uint8)"
													},
													typeName: "uint8"
												},
												id: 1862,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "typeConversion",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "19857:20:1",
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
											id: 1859,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "19849:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_uint256_$",
												typeString: "type(uint256)"
											},
											typeName: "uint256"
										},
										id: 1863,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "19849:29:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "19836:42:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1865,
								nodeType: "ExpressionStatement",
								src: "19836:42:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1872,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1866,
										name: "delegate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1839,
										src: "19888:8:1",
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
												id: 1870,
												isConstant: false,
												isLValue: false,
												isPure: false,
												lValueRequested: false,
												leftExpression: {
													argumentTypes: null,
													id: 1868,
													name: "tableMetadata",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1851,
													src: "19907:13:1",
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
													id: 1869,
													isConstant: false,
													isLValue: false,
													isPure: true,
													kind: "number",
													lValueRequested: false,
													nodeType: "Literal",
													src: "19922:1:1",
													subdenomination: null,
													typeDescriptions: {
														typeIdentifier: "t_rational_8_by_1",
														typeString: "int_const 8"
													},
													value: "8"
												},
												src: "19907:16:1",
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
											id: 1867,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "19899:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_address_$",
												typeString: "type(address)"
											},
											typeName: "address"
										},
										id: 1871,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "19899:25:1",
										typeDescriptions: {
											typeIdentifier: "t_address_payable",
											typeString: "address payable"
										}
									},
									src: "19888:36:1",
									typeDescriptions: {
										typeIdentifier: "t_address",
										typeString: "address"
									}
								},
								id: 1873,
								nodeType: "ExpressionStatement",
								src: "19888:36:1"
							}
						]
					},
					documentation: null,
					id: 1875,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getTableMetadata",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1835,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1834,
								name: "_tableKey",
								nodeType: "VariableDeclaration",
								scope: 1875,
								src: "19594:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1833,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "19594:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "19593:19:1"
					},
					returnParameters: {
						id: 1840,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1837,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 1875,
								src: "19658:18:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1836,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "19658:7:1",
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
								id: 1839,
								name: "delegate",
								nodeType: "VariableDeclaration",
								scope: 1875,
								src: "19678:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1838,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "19678:7:1",
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
						src: "19657:38:1"
					},
					scope: 2161,
					src: "19568:363:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 1909,
						nodeType: "Block",
						src: "20135:176:1",
						statements: [
							{
								assignments: [
									1887
								],
								declarations: [
									{
										constant: false,
										id: 1887,
										name: "tableMetadata",
										nodeType: "VariableDeclaration",
										scope: 1909,
										src: "20145:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1886,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "20145:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1888,
								initialValue: null,
								nodeType: "VariableDeclarationStatement",
								src: "20145:21:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1891,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1889,
										name: "tableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1887,
										src: "20177:13:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										id: 1890,
										name: "permission",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1879,
										src: "20194:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										}
									},
									src: "20177:27:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1892,
								nodeType: "ExpressionStatement",
								src: "20177:27:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1899,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1893,
										name: "tableMetadata",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1887,
										src: "20214:13:1",
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
										id: 1898,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 1895,
													name: "delegate",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 1881,
													src: "20239:8:1",
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
												id: 1894,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "20231:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint160_$",
													typeString: "type(uint160)"
												},
												typeName: "uint160"
											},
											id: 1896,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "20231:17:1",
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
											id: 1897,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "20250:1:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_8_by_1",
												typeString: "int_const 8"
											},
											value: "8"
										},
										src: "20231:20:1",
										typeDescriptions: {
											typeIdentifier: "t_uint160",
											typeString: "uint160"
										}
									},
									src: "20214:37:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1900,
								nodeType: "ExpressionStatement",
								src: "20214:37:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1907,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 1901,
											name: "_table",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 820,
											src: "20262:6:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_bytes32_$_t_bytes32_$",
												typeString: "mapping(bytes32 => bytes32)"
											}
										},
										id: 1903,
										indexExpression: {
											argumentTypes: null,
											id: 1902,
											name: "_tableKey",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1877,
											src: "20269:9:1",
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
										src: "20262:17:1",
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
												id: 1905,
												name: "tableMetadata",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1887,
												src: "20290:13:1",
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
											id: 1904,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "20282:7:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_bytes32_$",
												typeString: "type(bytes32)"
											},
											typeName: "bytes32"
										},
										id: 1906,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "20282:22:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									src: "20262:42:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								id: 1908,
								nodeType: "ExpressionStatement",
								src: "20262:42:1"
							}
						]
					},
					documentation: null,
					id: 1910,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1884,
							modifierName: {
								argumentTypes: null,
								id: 1883,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "20125:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "20125:9:1"
						}
					],
					name: "setTableMetadata",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1882,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1877,
								name: "_tableKey",
								nodeType: "VariableDeclaration",
								scope: 1910,
								src: "20062:17:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 1876,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "20062:7:1",
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
								id: 1879,
								name: "permission",
								nodeType: "VariableDeclaration",
								scope: 1910,
								src: "20081:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint8",
									typeString: "uint8"
								},
								typeName: {
									id: 1878,
									name: "uint8",
									nodeType: "ElementaryTypeName",
									src: "20081:5:1",
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
								id: 1881,
								name: "delegate",
								nodeType: "VariableDeclaration",
								scope: 1910,
								src: "20099:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1880,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "20099:7:1",
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
						src: "20061:55:1"
					},
					returnParameters: {
						id: 1885,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20135:0:1"
					},
					scope: 2161,
					src: "20036:275:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "private"
				},
				{
					body: {
						id: 1913,
						nodeType: "Block",
						src: "20444:2:1",
						statements: [
						]
					},
					documentation: null,
					id: 1914,
					implemented: true,
					kind: "fallback",
					modifiers: [
					],
					name: "",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1911,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20424:2:1"
					},
					returnParameters: {
						id: 1912,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "20444:0:1"
					},
					scope: 2161,
					src: "20416:30:1",
					stateMutability: "payable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1962,
						nodeType: "Block",
						src: "20985:312:1",
						statements: [
							{
								assignments: [
									1940
								],
								declarations: [
									{
										constant: false,
										id: 1940,
										name: "curDateHashed",
										nodeType: "VariableDeclaration",
										scope: 1962,
										src: "20996:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1939,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "20996:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1943,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1941,
										name: "getGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2059,
										src: "21020:13:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_bytes32_$",
											typeString: "function () view returns (bytes32)"
										}
									},
									id: 1942,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21020:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "20996:39:1"
							},
							{
								assignments: [
									1945
								],
								declarations: [
									{
										constant: false,
										id: 1945,
										name: "curCounter",
										nodeType: "VariableDeclaration",
										scope: 1962,
										src: "21105:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1944,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "21105:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1949,
								initialValue: {
									argumentTypes: null,
									baseExpression: {
										argumentTypes: null,
										id: 1946,
										name: "gsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 808,
										src: "21126:10:1",
										typeDescriptions: {
											typeIdentifier: "t_mapping$_t_bytes32_$_t_uint256_$",
											typeString: "mapping(bytes32 => uint256)"
										}
									},
									id: 1948,
									indexExpression: {
										argumentTypes: null,
										id: 1947,
										name: "curDateHashed",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1940,
										src: "21137:13:1",
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
									src: "21126:25:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "21105:46:1"
							},
							{
								condition: {
									argumentTypes: null,
									commonType: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									},
									id: 1952,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftExpression: {
										argumentTypes: null,
										id: 1950,
										name: "curCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1945,
										src: "21166:10:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "BinaryOperation",
									operator: ">=",
									rightExpression: {
										argumentTypes: null,
										id: 1951,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 810,
										src: "21180:17:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									src: "21166:31:1",
									typeDescriptions: {
										typeIdentifier: "t_bool",
										typeString: "bool"
									}
								},
								falseBody: null,
								id: 1958,
								nodeType: "IfStatement",
								src: "21162:89:1",
								trueBody: {
									id: 1957,
									nodeType: "Block",
									src: "21198:53:1",
									statements: [
										{
											expression: {
												argumentTypes: null,
												"arguments": [
													{
														argumentTypes: null,
														hexValue: "32",
														id: 1954,
														isConstant: false,
														isLValue: false,
														isPure: true,
														kind: "number",
														lValueRequested: false,
														nodeType: "Literal",
														src: "21238:1:1",
														subdenomination: null,
														typeDescriptions: {
															typeIdentifier: "t_rational_2_by_1",
															typeString: "int_const 2"
														},
														value: "2"
													}
												],
												expression: {
													argumentTypes: [
														{
															typeIdentifier: "t_rational_2_by_1",
															typeString: "int_const 2"
														}
													],
													id: 1953,
													name: "_rejectRelayedCall",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 3817,
													src: "21219:18:1",
													typeDescriptions: {
														typeIdentifier: "t_function_internal_pure$_t_uint256_$returns$_t_uint256_$_t_bytes_memory_ptr_$",
														typeString: "function (uint256) pure returns (uint256,bytes memory)"
													}
												},
												id: 1955,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "21219:21:1",
												typeDescriptions: {
													typeIdentifier: "t_tuple$_t_uint256_$_t_bytes_memory_ptr_$",
													typeString: "tuple(uint256,bytes memory)"
												}
											},
											functionReturnParameters: 1938,
											id: 1956,
											nodeType: "Return",
											src: "21212:28:1"
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
										id: 1959,
										name: "_approveRelayedCall",
										nodeType: "Identifier",
										overloadedDeclarations: [
											3787,
											3801
										],
										referencedDeclaration: 3787,
										src: "21269:19:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_pure$__$returns$_t_uint256_$_t_bytes_memory_ptr_$",
											typeString: "function () pure returns (uint256,bytes memory)"
										}
									},
									id: 1960,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21269:21:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$_t_uint256_$_t_bytes_memory_ptr_$",
										typeString: "tuple(uint256,bytes memory)"
									}
								},
								functionReturnParameters: 1938,
								id: 1961,
								nodeType: "Return",
								src: "21262:28:1"
							}
						]
					},
					documentation: "As a first layer of defense we employ a max number of checks per day",
					id: 1963,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "acceptRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1933,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1916,
								name: "relay",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20678:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1915,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "20678:7:1",
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
								id: 1918,
								name: "from",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20701:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address",
									typeString: "address"
								},
								typeName: {
									id: 1917,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "20701:7:1",
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
								id: 1920,
								name: "encodedFunction",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20723:30:1",
								stateVariable: false,
								storageLocation: "calldata",
								typeDescriptions: {
									typeIdentifier: "t_bytes_calldata_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1919,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "20723:5:1",
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
								id: 1922,
								name: "transactionFee",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20763:22:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1921,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20763:7:1",
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
								id: 1924,
								name: "gasPrice",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20795:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1923,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20795:7:1",
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
								id: 1926,
								name: "gasLimit",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20821:16:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1925,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20821:7:1",
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
								id: 1928,
								name: "nonce",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20847:13:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1927,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20847:7:1",
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
								id: 1930,
								name: "approvalData",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20870:27:1",
								stateVariable: false,
								storageLocation: "calldata",
								typeDescriptions: {
									typeIdentifier: "t_bytes_calldata_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1929,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "20870:5:1",
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
								id: 1932,
								name: "maxPossibleCharge",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20907:25:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1931,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20907:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "20668:270:1"
					},
					returnParameters: {
						id: 1938,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1935,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20962:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1934,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "20962:7:1",
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
								id: 1937,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 1963,
								src: "20971:12:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 1936,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "20971:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "20961:23:1"
					},
					scope: 2161,
					src: "20642:655:1",
					stateMutability: "view",
					superFunction: 3693,
					visibility: "external"
				},
				{
					body: {
						id: 1976,
						nodeType: "Block",
						src: "21365:48:1",
						statements: [
							{
								expression: {
									argumentTypes: null,
									id: 1974,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 1970,
										name: "gsnMaxCallsPerDay",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 810,
										src: "21375:17:1",
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
												id: 1972,
												name: "max",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 1965,
												src: "21402:3:1",
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
											id: 1971,
											isConstant: false,
											isLValue: false,
											isPure: true,
											lValueRequested: false,
											nodeType: "ElementaryTypeNameExpression",
											src: "21395:6:1",
											typeDescriptions: {
												typeIdentifier: "t_type$_t_uint40_$",
												typeString: "type(uint40)"
											},
											typeName: "uint40"
										},
										id: 1973,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "typeConversion",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "21395:11:1",
										typeDescriptions: {
											typeIdentifier: "t_uint40",
											typeString: "uint40"
										}
									},
									src: "21375:31:1",
									typeDescriptions: {
										typeIdentifier: "t_uint40",
										typeString: "uint40"
									}
								},
								id: 1975,
								nodeType: "ExpressionStatement",
								src: "21375:31:1"
							}
						]
					},
					documentation: null,
					id: 1977,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 1968,
							modifierName: {
								argumentTypes: null,
								id: 1967,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "21355:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "21355:9:1"
						}
					],
					name: "setGsnMaxCallsPerDay",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1966,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 1965,
								name: "max",
								nodeType: "VariableDeclaration",
								scope: 1977,
								src: "21333:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 1964,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "21333:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21332:13:1"
					},
					returnParameters: {
						id: 1969,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21365:0:1"
					},
					scope: 2161,
					src: "21303:110:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "external"
				},
				{
					body: {
						id: 1999,
						nodeType: "Block",
						src: "21631:243:1",
						statements: [
							{
								assignments: [
									1981
								],
								declarations: [
									{
										constant: false,
										id: 1981,
										name: "curDateHashed",
										nodeType: "VariableDeclaration",
										scope: 1999,
										src: "21642:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										},
										typeName: {
											id: 1980,
											name: "bytes32",
											nodeType: "ElementaryTypeName",
											src: "21642:7:1",
											typeDescriptions: {
												typeIdentifier: "t_bytes32",
												typeString: "bytes32"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1984,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 1982,
										name: "getGsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2059,
										src: "21666:13:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_bytes32_$",
											typeString: "function () view returns (bytes32)"
										}
									},
									id: 1983,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "21666:15:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "21642:39:1"
							},
							{
								assignments: [
									1986
								],
								declarations: [
									{
										constant: false,
										id: 1986,
										name: "curCounter",
										nodeType: "VariableDeclaration",
										scope: 1999,
										src: "21692:18:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 1985,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "21692:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 1990,
								initialValue: {
									argumentTypes: null,
									baseExpression: {
										argumentTypes: null,
										id: 1987,
										name: "gsnCounter",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 808,
										src: "21713:10:1",
										typeDescriptions: {
											typeIdentifier: "t_mapping$_t_bytes32_$_t_uint256_$",
											typeString: "mapping(bytes32 => uint256)"
										}
									},
									id: 1989,
									indexExpression: {
										argumentTypes: null,
										id: 1988,
										name: "curDateHashed",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 1981,
										src: "21724:13:1",
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
									src: "21713:25:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "21692:46:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 1997,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										baseExpression: {
											argumentTypes: null,
											id: 1991,
											name: "gsnCounter",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 808,
											src: "21749:10:1",
											typeDescriptions: {
												typeIdentifier: "t_mapping$_t_bytes32_$_t_uint256_$",
												typeString: "mapping(bytes32 => uint256)"
											}
										},
										id: 1993,
										indexExpression: {
											argumentTypes: null,
											id: 1992,
											name: "curDateHashed",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1981,
											src: "21760:13:1",
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
										src: "21749:25:1",
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
										id: 1996,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											id: 1994,
											name: "curCounter",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 1986,
											src: "21777:10:1",
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
											id: 1995,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "21790:1:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_1_by_1",
												typeString: "int_const 1"
											},
											value: "1"
										},
										src: "21777:14:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "21749:42:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 1998,
								nodeType: "ExpressionStatement",
								src: "21749:42:1"
							}
						]
					},
					documentation: "Increase the GSN Counter for today",
					id: 2000,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "increaseGsnCounter",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 1978,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21619:2:1"
					},
					returnParameters: {
						id: 1979,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21631:0:1"
					},
					scope: 2161,
					src: "21592:282:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 2058,
						nodeType: "Block",
						src: "21973:332:1",
						statements: [
							{
								assignments: [
									2006
								],
								declarations: [
									{
										constant: false,
										id: 2006,
										name: "curDate",
										nodeType: "VariableDeclaration",
										scope: 2058,
										src: "21984:15:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 2005,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "21984:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2007,
								initialValue: null,
								nodeType: "VariableDeclarationStatement",
								src: "21984:15:1"
							},
							{
								assignments: [
									2009
								],
								declarations: [
									{
										constant: false,
										id: 2009,
										name: "year",
										nodeType: "VariableDeclaration",
										scope: 2058,
										src: "22010:11:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint16",
											typeString: "uint16"
										},
										typeName: {
											id: 2008,
											name: "uint16",
											nodeType: "ElementaryTypeName",
											src: "22010:6:1",
											typeDescriptions: {
												typeIdentifier: "t_uint16",
												typeString: "uint16"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2014,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2012,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "22041:3:1",
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
										expression: {
											argumentTypes: null,
											id: 2010,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "22024:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 2011,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getYear",
										nodeType: "MemberAccess",
										referencedDeclaration: 783,
										src: "22024:16:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint16_$",
											typeString: "function (uint256) pure external returns (uint16)"
										}
									},
									id: 2013,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22024:21:1",
									typeDescriptions: {
										typeIdentifier: "t_uint16",
										typeString: "uint16"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "22010:35:1"
							},
							{
								assignments: [
									2016
								],
								declarations: [
									{
										constant: false,
										id: 2016,
										name: "month",
										nodeType: "VariableDeclaration",
										scope: 2058,
										src: "22055:11:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										},
										typeName: {
											id: 2015,
											name: "uint8",
											nodeType: "ElementaryTypeName",
											src: "22055:5:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2021,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2019,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "22087:3:1",
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
										expression: {
											argumentTypes: null,
											id: 2017,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "22069:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 2018,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getMonth",
										nodeType: "MemberAccess",
										referencedDeclaration: 790,
										src: "22069:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint8_$",
											typeString: "function (uint256) pure external returns (uint8)"
										}
									},
									id: 2020,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22069:22:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "22055:36:1"
							},
							{
								assignments: [
									2023
								],
								declarations: [
									{
										constant: false,
										id: 2023,
										name: "day",
										nodeType: "VariableDeclaration",
										scope: 2058,
										src: "22101:9:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint8",
											typeString: "uint8"
										},
										typeName: {
											id: 2022,
											name: "uint8",
											nodeType: "ElementaryTypeName",
											src: "22101:5:1",
											typeDescriptions: {
												typeIdentifier: "t_uint8",
												typeString: "uint8"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2028,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2026,
											name: "now",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10663,
											src: "22129:3:1",
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
										expression: {
											argumentTypes: null,
											id: 2024,
											name: "dateTime",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 804,
											src: "22113:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_DateTime_$798",
												typeString: "contract DateTime"
											}
										},
										id: 2025,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "getDay",
										nodeType: "MemberAccess",
										referencedDeclaration: 797,
										src: "22113:15:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_pure$_t_uint256_$returns$_t_uint8_$",
											typeString: "function (uint256) pure external returns (uint8)"
										}
									},
									id: 2027,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22113:20:1",
									typeDescriptions: {
										typeIdentifier: "t_uint8",
										typeString: "uint8"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "22101:32:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2031,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 2029,
										name: "curDate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2006,
										src: "22144:7:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									nodeType: "Assignment",
									operator: "|=",
									rightHandSide: {
										argumentTypes: null,
										id: 2030,
										name: "year",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2009,
										src: "22155:4:1",
										typeDescriptions: {
											typeIdentifier: "t_uint16",
											typeString: "uint16"
										}
									},
									src: "22144:15:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 2032,
								nodeType: "ExpressionStatement",
								src: "22144:15:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2039,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 2033,
										name: "curDate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2006,
										src: "22169:7:1",
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
										id: 2038,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 2035,
													name: "month",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 2016,
													src: "22188:5:1",
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
												id: 2034,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "22180:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
											},
											id: 2036,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "22180:14:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "3136",
											id: 2037,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "22196:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_16_by_1",
												typeString: "int_const 16"
											},
											value: "16"
										},
										src: "22180:18:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "22169:29:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 2040,
								nodeType: "ExpressionStatement",
								src: "22169:29:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2047,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 2041,
										name: "curDate",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2006,
										src: "22208:7:1",
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
										id: 2046,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										leftExpression: {
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 2043,
													name: "day",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 2023,
													src: "22227:3:1",
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
												id: 2042,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "22219:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_uint256_$",
													typeString: "type(uint256)"
												},
												typeName: "uint256"
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
											src: "22219:12:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										nodeType: "BinaryOperation",
										operator: "<<",
										rightExpression: {
											argumentTypes: null,
											hexValue: "3234",
											id: 2045,
											isConstant: false,
											isLValue: false,
											isPure: true,
											kind: "number",
											lValueRequested: false,
											nodeType: "Literal",
											src: "22233:2:1",
											subdenomination: null,
											typeDescriptions: {
												typeIdentifier: "t_rational_24_by_1",
												typeString: "int_const 24"
											},
											value: "24"
										},
										src: "22219:16:1",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										}
									},
									src: "22208:27:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								id: 2048,
								nodeType: "ExpressionStatement",
								src: "22208:27:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2056,
									isConstant: false,
									isLValue: false,
									isPure: false,
									lValueRequested: false,
									leftHandSide: {
										argumentTypes: null,
										id: 2049,
										name: "curDateHashed",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2003,
										src: "22246:13:1",
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
												"arguments": [
													{
														argumentTypes: null,
														id: 2053,
														name: "curDate",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 2006,
														src: "22289:7:1",
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
													expression: {
														argumentTypes: null,
														id: 2051,
														name: "abi",
														nodeType: "Identifier",
														overloadedDeclarations: [
														],
														referencedDeclaration: 10648,
														src: "22272:3:1",
														typeDescriptions: {
															typeIdentifier: "t_magic_abi",
															typeString: "abi"
														}
													},
													id: 2052,
													isConstant: false,
													isLValue: false,
													isPure: true,
													lValueRequested: false,
													memberName: "encodePacked",
													nodeType: "MemberAccess",
													referencedDeclaration: null,
													src: "22272:16:1",
													typeDescriptions: {
														typeIdentifier: "t_function_abiencodepacked_pure$__$returns$_t_bytes_memory_ptr_$",
														typeString: "function () pure returns (bytes memory)"
													}
												},
												id: 2054,
												isConstant: false,
												isLValue: false,
												isPure: false,
												kind: "functionCall",
												lValueRequested: false,
												names: [
												],
												nodeType: "FunctionCall",
												src: "22272:25:1",
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
											id: 2050,
											name: "keccak256",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 10655,
											src: "22262:9:1",
											typeDescriptions: {
												typeIdentifier: "t_function_keccak256_pure$_t_bytes_memory_ptr_$returns$_t_bytes32_$",
												typeString: "function (bytes memory) pure returns (bytes32)"
											}
										},
										id: 2055,
										isConstant: false,
										isLValue: false,
										isPure: false,
										kind: "functionCall",
										lValueRequested: false,
										names: [
										],
										nodeType: "FunctionCall",
										src: "22262:36:1",
										typeDescriptions: {
											typeIdentifier: "t_bytes32",
											typeString: "bytes32"
										}
									},
									src: "22246:52:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								id: 2057,
								nodeType: "ExpressionStatement",
								src: "22246:52:1"
							}
						]
					},
					documentation: null,
					id: 2059,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getGsnCounter",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2001,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "21924:2:1"
					},
					returnParameters: {
						id: 2004,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2003,
								name: "curDateHashed",
								nodeType: "VariableDeclaration",
								scope: 2059,
								src: "21950:21:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 2002,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "21950:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "21949:23:1"
					},
					scope: 2161,
					src: "21902:403:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "internal"
				},
				{
					body: {
						id: 2066,
						nodeType: "Block",
						src: "22484:7:1",
						statements: [
						]
					},
					documentation: null,
					id: 2067,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_preRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2062,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2061,
								name: "context",
								nodeType: "VariableDeclaration",
								scope: 2067,
								src: "22435:20:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 2060,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "22435:5:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes_storage_ptr",
										typeString: "bytes"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "22434:22:1"
					},
					returnParameters: {
						id: 2065,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2064,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2067,
								src: "22475:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 2063,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "22475:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "22474:9:1"
					},
					scope: 2161,
					src: "22410:81:1",
					stateMutability: "nonpayable",
					superFunction: 3825,
					visibility: "internal"
				},
				{
					body: {
						id: 2078,
						nodeType: "Block",
						src: "22591:7:1",
						statements: [
						]
					},
					documentation: null,
					id: 2079,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "_postRelayedCall",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2076,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2069,
								name: "context",
								nodeType: "VariableDeclaration",
								scope: 2079,
								src: "22523:20:1",
								stateVariable: false,
								storageLocation: "memory",
								typeDescriptions: {
									typeIdentifier: "t_bytes_memory_ptr",
									typeString: "bytes"
								},
								typeName: {
									id: 2068,
									name: "bytes",
									nodeType: "ElementaryTypeName",
									src: "22523:5:1",
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
								id: 2071,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2079,
								src: "22545:4:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bool",
									typeString: "bool"
								},
								typeName: {
									id: 2070,
									name: "bool",
									nodeType: "ElementaryTypeName",
									src: "22545:4:1",
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
								id: 2073,
								name: "actualCharge",
								nodeType: "VariableDeclaration",
								scope: 2079,
								src: "22551:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 2072,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "22551:7:1",
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
								id: 2075,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2079,
								src: "22573:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_bytes32",
									typeString: "bytes32"
								},
								typeName: {
									id: 2074,
									name: "bytes32",
									nodeType: "ElementaryTypeName",
									src: "22573:7:1",
									typeDescriptions: {
										typeIdentifier: "t_bytes32",
										typeString: "bytes32"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "22522:59:1"
					},
					returnParameters: {
						id: 2077,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "22591:0:1"
					},
					scope: 2161,
					src: "22497:101:1",
					stateMutability: "nonpayable",
					superFunction: 3837,
					visibility: "internal"
				},
				{
					body: {
						id: 2100,
						nodeType: "Block",
						src: "22872:92:1",
						statements: [
							{
								assignments: [
									2089
								],
								declarations: [
									{
										constant: false,
										id: 2089,
										name: "relayHub",
										nodeType: "VariableDeclaration",
										scope: 2100,
										src: "22882:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_contract$_IRelayHubELA_$3661",
											typeString: "contract IRelayHubELA"
										},
										typeName: {
											contractScope: null,
											id: 2088,
											name: "IRelayHubELA",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 3661,
											src: "22882:12:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2092,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 2090,
										name: "getRelayHub",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2160,
										src: "22906:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3661_$",
											typeString: "function () view returns (contract IRelayHubELA)"
										}
									},
									id: 2091,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22906:13:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3661",
										typeString: "contract IRelayHubELA"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "22882:37:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2096,
											name: "amt",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2081,
											src: "22947:3:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										{
											argumentTypes: null,
											id: 2097,
											name: "dest",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2083,
											src: "22952:4:1",
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
											id: 2093,
											name: "relayHub",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2089,
											src: "22929:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2095,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "withdraw",
										nodeType: "MemberAccess",
										referencedDeclaration: 3515,
										src: "22929:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_nonpayable$_t_uint256_$_t_address_payable_$returns$__$",
											typeString: "function (uint256,address payable) external"
										}
									},
									id: 2098,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "22929:28:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 2099,
								nodeType: "ExpressionStatement",
								src: "22929:28:1"
							}
						]
					},
					documentation: "@dev Withdraw a specific amount of the GSNReceipient funds\n@param amt Amount of wei to withdraw\n@param dest This is the arbitrary withdrawal destination address",
					id: 2101,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 2086,
							modifierName: {
								argumentTypes: null,
								id: 2085,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "22862:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "22862:9:1"
						}
					],
					name: "withdraw",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2084,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2081,
								name: "amt",
								nodeType: "VariableDeclaration",
								scope: 2101,
								src: "22820:11:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 2080,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "22820:7:1",
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
								id: 2083,
								name: "dest",
								nodeType: "VariableDeclaration",
								scope: 2101,
								src: "22833:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address_payable",
									typeString: "address payable"
								},
								typeName: {
									id: 2082,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "22833:15:1",
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
						src: "22819:35:1"
					},
					returnParameters: {
						id: 2087,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "22872:0:1"
					},
					scope: 2161,
					src: "22802:162:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2134,
						nodeType: "Block",
						src: "23185:186:1",
						statements: [
							{
								assignments: [
									2111
								],
								declarations: [
									{
										constant: false,
										id: 2111,
										name: "relayHub",
										nodeType: "VariableDeclaration",
										scope: 2134,
										src: "23195:21:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_contract$_IRelayHubELA_$3661",
											typeString: "contract IRelayHubELA"
										},
										typeName: {
											contractScope: null,
											id: 2110,
											name: "IRelayHubELA",
											nodeType: "UserDefinedTypeName",
											referencedDeclaration: 3661,
											src: "23195:12:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2114,
								initialValue: {
									argumentTypes: null,
									"arguments": [
									],
									expression: {
										argumentTypes: [
										],
										id: 2112,
										name: "getRelayHub",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 2160,
										src: "23219:11:1",
										typeDescriptions: {
											typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3661_$",
											typeString: "function () view returns (contract IRelayHubELA)"
										}
									},
									id: 2113,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "23219:13:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3661",
										typeString: "contract IRelayHubELA"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "23195:37:1"
							},
							{
								assignments: [
									2116
								],
								declarations: [
									{
										constant: false,
										id: 2116,
										name: "balance",
										nodeType: "VariableDeclaration",
										scope: 2134,
										src: "23242:15:1",
										stateVariable: false,
										storageLocation: "default",
										typeDescriptions: {
											typeIdentifier: "t_uint256",
											typeString: "uint256"
										},
										typeName: {
											id: 2115,
											name: "uint256",
											nodeType: "ElementaryTypeName",
											src: "23242:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										value: null,
										visibility: "internal"
									}
								],
								id: 2124,
								initialValue: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											"arguments": [
												{
													argumentTypes: null,
													id: 2121,
													name: "this",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 10718,
													src: "23292:4:1",
													typeDescriptions: {
														typeIdentifier: "t_contract$_ELAJSStore_$2161",
														typeString: "contract ELAJSStore"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_contract$_ELAJSStore_$2161",
														typeString: "contract ELAJSStore"
													}
												],
												id: 2120,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "23284:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_address_$",
													typeString: "type(address)"
												},
												typeName: "address"
											},
											id: 2122,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "23284:13:1",
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
												id: 2117,
												name: "getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 2160,
												src: "23260:11:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3661_$",
													typeString: "function () view returns (contract IRelayHubELA)"
												}
											},
											id: 2118,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "23260:13:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2119,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "balanceOf",
										nodeType: "MemberAccess",
										referencedDeclaration: 3508,
										src: "23260:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_view$_t_address_$returns$_t_uint256_$",
											typeString: "function (address) view external returns (uint256)"
										}
									},
									id: 2123,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "23260:38:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								nodeType: "VariableDeclarationStatement",
								src: "23242:56:1"
							},
							{
								expression: {
									argumentTypes: null,
									"arguments": [
										{
											argumentTypes: null,
											id: 2128,
											name: "balance",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2116,
											src: "23326:7:1",
											typeDescriptions: {
												typeIdentifier: "t_uint256",
												typeString: "uint256"
											}
										},
										{
											argumentTypes: null,
											id: 2129,
											name: "dest",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2103,
											src: "23335:4:1",
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
											id: 2125,
											name: "relayHub",
											nodeType: "Identifier",
											overloadedDeclarations: [
											],
											referencedDeclaration: 2111,
											src: "23308:8:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2127,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "withdraw",
										nodeType: "MemberAccess",
										referencedDeclaration: 3515,
										src: "23308:17:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_nonpayable$_t_uint256_$_t_address_payable_$returns$__$",
											typeString: "function (uint256,address payable) external"
										}
									},
									id: 2130,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "23308:32:1",
									typeDescriptions: {
										typeIdentifier: "t_tuple$__$",
										typeString: "tuple()"
									}
								},
								id: 2131,
								nodeType: "ExpressionStatement",
								src: "23308:32:1"
							},
							{
								expression: {
									argumentTypes: null,
									id: 2132,
									name: "balance",
									nodeType: "Identifier",
									overloadedDeclarations: [
									],
									referencedDeclaration: 2116,
									src: "23357:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								functionReturnParameters: 2109,
								id: 2133,
								nodeType: "Return",
								src: "23350:14:1"
							}
						]
					},
					documentation: "@dev Withdraw all the GSNReceipient funds\n@param dest This is the arbitrary withdrawal destination address",
					id: 2135,
					implemented: true,
					kind: "function",
					modifiers: [
						{
							"arguments": null,
							id: 2106,
							modifierName: {
								argumentTypes: null,
								id: 2105,
								name: "onlyOwner",
								nodeType: "Identifier",
								overloadedDeclarations: [
								],
								referencedDeclaration: 4658,
								src: "23157:9:1",
								typeDescriptions: {
									typeIdentifier: "t_modifier$__$",
									typeString: "modifier ()"
								}
							},
							nodeType: "ModifierInvocation",
							src: "23157:9:1"
						}
					],
					name: "withdrawAll",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2104,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2103,
								name: "dest",
								nodeType: "VariableDeclaration",
								scope: 2135,
								src: "23128:20:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_address_payable",
									typeString: "address payable"
								},
								typeName: {
									id: 2102,
									name: "address",
									nodeType: "ElementaryTypeName",
									src: "23128:15:1",
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
						src: "23127:22:1"
					},
					returnParameters: {
						id: 2109,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2108,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2135,
								src: "23176:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 2107,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "23176:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "23175:9:1"
					},
					scope: 2161,
					src: "23107:264:1",
					stateMutability: "nonpayable",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2148,
						nodeType: "Block",
						src: "23432:62:1",
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
													id: 2144,
													name: "this",
													nodeType: "Identifier",
													overloadedDeclarations: [
													],
													referencedDeclaration: 10718,
													src: "23481:4:1",
													typeDescriptions: {
														typeIdentifier: "t_contract$_ELAJSStore_$2161",
														typeString: "contract ELAJSStore"
													}
												}
											],
											expression: {
												argumentTypes: [
													{
														typeIdentifier: "t_contract$_ELAJSStore_$2161",
														typeString: "contract ELAJSStore"
													}
												],
												id: 2143,
												isConstant: false,
												isLValue: false,
												isPure: true,
												lValueRequested: false,
												nodeType: "ElementaryTypeNameExpression",
												src: "23473:7:1",
												typeDescriptions: {
													typeIdentifier: "t_type$_t_address_$",
													typeString: "type(address)"
												},
												typeName: "address"
											},
											id: 2145,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "typeConversion",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "23473:13:1",
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
												id: 2140,
												name: "getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 2160,
												src: "23449:11:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_contract$_IRelayHubELA_$3661_$",
													typeString: "function () view returns (contract IRelayHubELA)"
												}
											},
											id: 2141,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "23449:13:1",
											typeDescriptions: {
												typeIdentifier: "t_contract$_IRelayHubELA_$3661",
												typeString: "contract IRelayHubELA"
											}
										},
										id: 2142,
										isConstant: false,
										isLValue: false,
										isPure: false,
										lValueRequested: false,
										memberName: "balanceOf",
										nodeType: "MemberAccess",
										referencedDeclaration: 3508,
										src: "23449:23:1",
										typeDescriptions: {
											typeIdentifier: "t_function_external_view$_t_address_$returns$_t_uint256_$",
											typeString: "function (address) view external returns (uint256)"
										}
									},
									id: 2146,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "functionCall",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "23449:38:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								functionReturnParameters: 2139,
								id: 2147,
								nodeType: "Return",
								src: "23442:45:1"
							}
						]
					},
					documentation: null,
					id: 2149,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getGSNBalance",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2136,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "23399:2:1"
					},
					returnParameters: {
						id: 2139,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2138,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2149,
								src: "23423:7:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_uint256",
									typeString: "uint256"
								},
								typeName: {
									id: 2137,
									name: "uint256",
									nodeType: "ElementaryTypeName",
									src: "23423:7:1",
									typeDescriptions: {
										typeIdentifier: "t_uint256",
										typeString: "uint256"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "23422:9:1"
					},
					scope: 2161,
					src: "23377:117:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "public"
				},
				{
					body: {
						id: 2159,
						nodeType: "Block",
						src: "23560:52:1",
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
												id: 2155,
												name: "_getRelayHub",
												nodeType: "Identifier",
												overloadedDeclarations: [
												],
												referencedDeclaration: 3200,
												src: "23590:12:1",
												typeDescriptions: {
													typeIdentifier: "t_function_internal_view$__$returns$_t_address_$",
													typeString: "function () view returns (address)"
												}
											},
											id: 2156,
											isConstant: false,
											isLValue: false,
											isPure: false,
											kind: "functionCall",
											lValueRequested: false,
											names: [
											],
											nodeType: "FunctionCall",
											src: "23590:14:1",
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
										id: 2154,
										name: "IRelayHubELA",
										nodeType: "Identifier",
										overloadedDeclarations: [
										],
										referencedDeclaration: 3661,
										src: "23577:12:1",
										typeDescriptions: {
											typeIdentifier: "t_type$_t_contract$_IRelayHubELA_$3661_$",
											typeString: "type(contract IRelayHubELA)"
										}
									},
									id: 2157,
									isConstant: false,
									isLValue: false,
									isPure: false,
									kind: "typeConversion",
									lValueRequested: false,
									names: [
									],
									nodeType: "FunctionCall",
									src: "23577:28:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3661",
										typeString: "contract IRelayHubELA"
									}
								},
								functionReturnParameters: 2153,
								id: 2158,
								nodeType: "Return",
								src: "23570:35:1"
							}
						]
					},
					documentation: null,
					id: 2160,
					implemented: true,
					kind: "function",
					modifiers: [
					],
					name: "getRelayHub",
					nodeType: "FunctionDefinition",
					parameters: {
						id: 2150,
						nodeType: "ParameterList",
						parameters: [
						],
						src: "23520:2:1"
					},
					returnParameters: {
						id: 2153,
						nodeType: "ParameterList",
						parameters: [
							{
								constant: false,
								id: 2152,
								name: "",
								nodeType: "VariableDeclaration",
								scope: 2160,
								src: "23546:12:1",
								stateVariable: false,
								storageLocation: "default",
								typeDescriptions: {
									typeIdentifier: "t_contract$_IRelayHubELA_$3661",
									typeString: "contract IRelayHubELA"
								},
								typeName: {
									contractScope: null,
									id: 2151,
									name: "IRelayHubELA",
									nodeType: "UserDefinedTypeName",
									referencedDeclaration: 3661,
									src: "23546:12:1",
									typeDescriptions: {
										typeIdentifier: "t_contract$_IRelayHubELA_$3661",
										typeString: "contract IRelayHubELA"
									}
								},
								value: null,
								visibility: "internal"
							}
						],
						src: "23545:14:1"
					},
					scope: 2161,
					src: "23500:112:1",
					stateMutability: "view",
					superFunction: null,
					visibility: "internal"
				}
			],
			scope: 2162,
			src: "862:22752:1"
		}
	],
	src: "0:23615:1"
};
var bytecode = "0x6080604052615fba806100136000396000f3fe6080604052600436106101b6576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168062f714ce146101b857806301ee810a146101e15780631fd6dda51461020c57806328343c3414610249578063287e724614610274578063365628a2146102b25780633c2e8599146102db5780633ffe300e146103065780634102fbf61461032f578063485cc9551461035a57806359cb73a4146103835780636729003c146103c0578063715018a6146103fd57806374e861d6146104145780637af9c6631461043f5780637e03a8241461047c57806380274db7146104a55780638175d7eb146104e257806383947ea01461050b5780638d3178cc146105495780638da5cb5b146105725780638f32d59b1461059d578063a2ea7c6e146105c8578063ad61ccd514610605578063b467949b14610630578063bc41c3dd14610659578063c2309bf914610682578063c4d66de8146106bf578063d887f105146106e8578063e06e0e2214610726578063e3c504e41461074f578063ed90cb371461078c578063f201fe2a146107b5578063f2fde38b146107f2578063fa09e6301461081b575b005b3480156101c457600080fd5b506101df60048036036101da9190810190614e2a565b610858565b005b3480156101ed57600080fd5b506101f661093a565b6040516102039190615cfb565b60405180910390f35b34801561021857600080fd5b50610233600480360361022e9190810190614993565b610951565b6040516102409190615839565b60405180910390f35b34801561025557600080fd5b5061025e61096e565b60405161026b9190615817565b60405180910390f35b34801561028057600080fd5b5061029b60048036036102969190810190614993565b6109ac565b6040516102a99291906157ee565b60405180910390f35b3480156102be57600080fd5b506102d960048036036102d49190810190614c43565b610a02565b005b3480156102e757600080fd5b506102f0610b1a565b6040516102fd9190615c5e565b60405180910390f35b34801561031257600080fd5b5061032d60048036036103289190810190614bb4565b610bcd565b005b34801561033b57600080fd5b50610344610da1565b6040516103519190615854565b60405180910390f35b34801561036657600080fd5b50610381600480360361037c9190810190614857565b610dc8565b005b34801561038f57600080fd5b506103aa60048036036103a59190810190614993565b610f10565b6040516103b79190615c5e565b60405180910390f35b3480156103cc57600080fd5b506103e760048036036103e29190810190614993565b610f28565b6040516103f49190615854565b60405180910390f35b34801561040957600080fd5b50610412610f6b565b005b34801561042057600080fd5b50610429611075565b60405161043691906157b8565b60405180910390f35b34801561044b57600080fd5b50610466600480360361046191908101906149f8565b611084565b6040516104739190615839565b60405180910390f35b34801561048857600080fd5b506104a3600480360361049e9190810190614b3d565b611113565b005b3480156104b157600080fd5b506104cc60048036036104c79190810190614cea565b6111a6565b6040516104d99190615854565b60405180910390f35b3480156104ee57600080fd5b5061050960048036036105049190810190614a8b565b611274565b005b34801561051757600080fd5b50610532600480360361052d9190810190614893565b6112b3565b604051610540929190615ccb565b60405180910390f35b34801561055557600080fd5b50610570600480360361056b9190810190614ada565b611332565b005b34801561057e57600080fd5b506105876113cc565b60405161059491906157b8565b60405180910390f35b3480156105a957600080fd5b506105b26113f6565b6040516105bf9190615839565b60405180910390f35b3480156105d457600080fd5b506105ef60048036036105ea9190810190614993565b611455565b6040516105fc9190615c3c565b60405180910390f35b34801561061157600080fd5b5061061a611486565b60405161062791906158ba565b60405180910390f35b34801561063c57600080fd5b5061065760048036036106529190810190614b3d565b6114c3565b005b34801561066557600080fd5b50610680600480360361067b9190810190614dd8565b6116da565b005b34801561068e57600080fd5b506106a960048036036106a49190810190614993565b611749565b6040516106b69190615817565b60405180910390f35b3480156106cb57600080fd5b506106e660048036036106e19190810190614805565b6117c2565b005b3480156106f457600080fd5b5061070f600480360361070a9190810190614993565b6118b7565b60405161071d929190615c79565b60405180910390f35b34801561073257600080fd5b5061074d60048036036107489190810190614d2f565b61194c565b005b34801561075b57600080fd5b5061077660048036036107719190810190614993565b611a1a565b6040516107839190615898565b60405180910390f35b34801561079857600080fd5b506107b360048036036107ae91908101906149bc565b611a8d565b005b3480156107c157600080fd5b506107dc60048036036107d791908101906149bc565b611b45565b6040516107e99190615839565b60405180910390f35b3480156107fe57600080fd5b5061081960048036036108149190810190614805565b611b65565b005b34801561082757600080fd5b50610842600480360361083d919081019061482e565b611bba565b60405161084f9190615c5e565b60405180910390f35b6108606113f6565b15156108a1576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161089890615a9c565b60405180910390fd5b60006108ab611d53565b90508073ffffffffffffffffffffffffffffffffffffffff1662f714ce84846040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610903929190615ca2565b600060405180830381600087803b15801561091d57600080fd5b505af1158015610931573d6000803e3d6000fd5b50505050505050565b606860009054906101000a900464ffffffffff1681565b600061096782606d611d6290919063ffffffff16565b9050919050565b60606109a77f736368656d61732e7075626c69632e7461626c65730000000000000000000000600102606d611dd990919063ffffffff16565b905090565b60008060006109c584606d611df990919063ffffffff16565b600190049050807c0100000000000000000000000000000000000000000000000000000000029150602081908060020a8204915050925050915091565b610a0a6113f6565b1515610a4b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a4290615a9c565b60405180910390fd5b60006001026069600086815260200190815260200160002054141515610aa6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a9d90615b5c565b60405180910390fd5b6000809050610ab6858583611e19565b610aef7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010287606d611ec59092919063ffffffff16565b50610b0485606a611ff090919063ffffffff16565b50610b1186868585611084565b50505050505050565b6000610b24611d53565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610b7891906157d3565b60206040518083038186803b158015610b9057600080fd5b505afa158015610ba4573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250610bc89190810190614e01565b905090565b84600080610bda836118b7565b91509150600082111515610c23576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610c1a9061597c565b60405180910390fd5b6001821180610c3d575060011515610c396113f6565b1515145b80610c7a5750610c4b612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515610cbb576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610cb290615a5c565b60405180910390fd5b6000610cc7888a612064565b90506000610cd58883612064565b905060001515610cef82606d611d6290919063ffffffff16565b1515141515610d33576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610d2a90615adc565b60405180910390fd5b610d3b6120c1565b610d518a88606a6121049092919063ffffffff16565b5060001515610d6a83606d611d6290919063ffffffff16565b15151415610d7e57610d7d82888c61214f565b5b610d948187606d6124a59092919063ffffffff16565b5050505050505050505050565b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010281565b600060019054906101000a900460ff1680610de75750610de66125d0565b5b80610dfe57506000809054906101000a900460ff16155b1515610e3f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610e3690615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015610e8f576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81606660006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550610ed9336125e7565b610ee2836117c2565b610eea612791565b8015610f0b5760008060016101000a81548160ff0219169083151502179055505b505050565b60676020528060005260406000206000915090505481565b6000610f3e82606d611d6290919063ffffffff16565b15610f5e57610f5782606d611df990919063ffffffff16565b9050610f66565b600060010290505b919050565b610f736113f6565b1515610fb4576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610fab90615a9c565b60405180910390fd5b600073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a36000603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550565b600061107f6127f3565b905090565b600061108e6113f6565b15156110cf576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016110c690615a9c565b60405180910390fd5b6110d76144e0565b6110e2868585612824565b905060606110ef826128a1565b90506111078682606d6124a59092919063ffffffff16565b92505050949350505050565b600061111f8587612064565b9050600061112d8583612064565b905061113b87878487612971565b6111436120c1565b6111598184606d612bcc9092919063ffffffff16565b508285887f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b7187611187612010565b60405161119592919061586f565b60405180910390a450505050505050565b60006111b0611075565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151561121f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611216906158fc565b60405180910390fd5b61126c83838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050612cf7565b905092915050565b60006112808385612064565b905061128e84828585612cfe565b6112966120c1565b6112ac8483606a612f529092919063ffffffff16565b5050505050565b6000606060006112c1612f9d565b9050600060676000838152602001908152602001600020549050606860009054906101000a900464ffffffffff1664ffffffffff1681101515611313576113086002613258565b935093505050611322565b61131b61327a565b9350935050505b9b509b9950505050505050505050565b600061133e8486612064565b9050600061134c8483612064565b905061135a86838786612cfe565b6113626120c1565b600061137882606d61329f90919063ffffffff16565b9050600115158115151415156113c3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016113ba90615a7c565b60405180910390fd5b50505050505050565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16905090565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16611439612010565b73ffffffffffffffffffffffffffffffffffffffff1614905090565b61145d6144e0565b606061147383606d61331690919063ffffffff16565b905061147e81613336565b915050919050565b60606040805190810160405280600581526020017f312e302e30000000000000000000000000000000000000000000000000000000815250905090565b846000806114d0836118b7565b91509150600082111515611519576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115109061597c565b60405180910390fd5b600182118061153357506001151561152f6113f6565b1515145b806115705750611541612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15156115b1576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115a890615a5c565b60405180910390fd5b60006115bd888a612064565b905060006115cb8883612064565b9050600015156115e582606d611d6290919063ffffffff16565b1515141515611629576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161162090615adc565b60405180910390fd5b6116316120c1565b6116478a88606a6121049092919063ffffffff16565b506000151561166083606d611d6290919063ffffffff16565b151514156116745761167382888c61214f565b5b61168a8187606d612bcc9092919063ffffffff16565b5085888b7f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718a6116b8612010565b6040516116c692919061586f565b60405180910390a450505050505050505050565b6116e26113f6565b1515611723576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161171a90615a9c565b60405180910390fd5b80606860006101000a81548164ffffffffff021916908364ffffffffff16021790555050565b60606001151561176383606a6133df90919063ffffffff16565b15151415156117a7576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161179e90615b9c565b60405180910390fd5b6117bb82606a6133ff90919063ffffffff16565b9050919050565b600060019054906101000a900460ff16806117e157506117e06125d0565b5b806117f857506000809054906101000a900460ff16155b1515611839576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161183090615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015611889576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b6118928261346e565b80156118b35760008060016101000a81548160ff0219169083151502179055505b5050565b60008060006001026069600085815260200190815260200160002054111515611915576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161190c90615bfc565b60405180910390fd5b600060696000858152602001908152602001600020546001900490508060ff169250600881908060020a8204915050915050915091565b611954611075565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156119c3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016119ba906158fc565b60405180910390fd5b611a1385858080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050848484613563565b5050505050565b6060611a3082606d611d6290919063ffffffff16565b15611a5057611a4982606d61331690919063ffffffff16565b9050611a88565b60006040519080825280601f01601f191660200182016040528015611a845781602001600182028038833980820191505090505b5090505b919050565b611a956113f6565b1515611ad6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611acd90615a9c565b60405180910390fd5b60006001026069600083815260200190815260200160002081905550611b2b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010283606d6135699092919063ffffffff16565b50611b4081606a61358c90919063ffffffff16565b505050565b6000611b5d8383606a6135c59092919063ffffffff16565b905092915050565b611b6d6113f6565b1515611bae576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611ba590615a9c565b60405180910390fd5b611bb781613610565b50565b6000611bc46113f6565b1515611c05576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611bfc90615a9c565b60405180910390fd5b6000611c0f611d53565b90506000611c1b611d53565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611c6f91906157d3565b60206040518083038186803b158015611c8757600080fd5b505afa158015611c9b573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611cbf9190810190614e01565b90508173ffffffffffffffffffffffffffffffffffffffff1662f714ce82866040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611d17929190615ca2565b600060405180830381600087803b158015611d3157600080fd5b505af1158015611d45573d6000803e3d6000fd5b505050508092505050919050565b6000611d5d6127f3565b905090565b6000611d7a828460000161374290919063ffffffff16565b80611d975750611d96828460030161376290919063ffffffff16565b5b80611db45750611db382846006016133df90919063ffffffff16565b5b80611dd15750611dd0828460090161378290919063ffffffff16565b5b905092915050565b6060611df182846006016133ff90919063ffffffff16565b905092915050565b6000611e1182846000016137a290919063ffffffff16565b905092915050565b611e216113f6565b1515611e62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611e5990615a9c565b60405180910390fd5b60008260ff168117905060088273ffffffffffffffffffffffffffffffffffffffff169060020a0273ffffffffffffffffffffffffffffffffffffffff168117905080600102606960008681526020019081526020016000208190555050505050565b6000611edd838560000161374290919063ffffffff16565b151515611f1f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611f16906159dc565b60405180910390fd5b611f35838560030161376290919063ffffffff16565b151515611f77576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611f6e906159dc565b60405180910390fd5b611f8d838560090161378290919063ffffffff16565b151515611fcf576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611fc6906159dc565b60405180910390fd5b611fe78383866006016121049092919063ffffffff16565b90509392505050565b6000612008828460010161380d90919063ffffffff16565b905092915050565b600061201a6127f3565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151561205657339050612061565b61205e613879565b90505b90565b60006060604080519080825280601f01601f19166020018201604052801561209b5781602001600182028038833980820191505090505b509050836040820152826020820152600081805190602001209050809250505092915050565b60006120cb612f9d565b90506000606760008381526020019081526020016000205490506001810160676000848152602001908152602001600020819055505050565b600061211084846133df565b156121435761213c8285600001600086815260200190815260200160002061380d90919063ffffffff16565b9050612148565b600090505b9392505050565b6000151561216784606d611d6290919063ffffffff16565b15151415156121ab576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121a2906159fc565b60405180910390fd5b600080606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166392d66313426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016122259190615c5e565b60206040518083038186803b15801561223d57600080fd5b505afa158015612251573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506122759190810190614daf565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1663a324ad24426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016122f09190615c5e565b60206040518083038186803b15801561230857600080fd5b505afa15801561231c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506123409190810190614e66565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166365c72840426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016123bb9190615c5e565b60206040518083038186803b1580156123d357600080fd5b505afa1580156123e7573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525061240b9190810190614e66565b90508261ffff168417935060108260ff169060020a028417935060188160ff169060020a02841793506000847c01000000000000000000000000000000000000000000000000000000000290506020612462612010565b73ffffffffffffffffffffffffffffffffffffffff169060020a028517945061249a8886600102606d612bcc9092919063ffffffff16565b505050505050505050565b60006124bd838560000161374290919063ffffffff16565b1515156124ff576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016124f6906159dc565b60405180910390fd5b61251583856006016133df90919063ffffffff16565b151515612557576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161254e906159dc565b60405180910390fd5b61256d838560090161378290919063ffffffff16565b1515156125af576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016125a6906159dc565b60405180910390fd5b6125c78383866003016138f19092919063ffffffff16565b90509392505050565b6000803090506000813b9050600081149250505090565b600060019054906101000a900460ff168061260657506126056125d0565b5b8061261d57506000809054906101000a900460ff16155b151561265e576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161265590615abc565b60405180910390fd5b60008060019054906101000a900460ff1615905080156126ae576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16600073ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a3801561278d5760008060016101000a81548160ff0219169083151502179055505b5050565b6103e8606860006101000a81548164ffffffffff021916908364ffffffffff1602179055506127f07f736368656d61732e7075626c69632e7461626c657300000000000000000000006001026000606d61393c9092919063ffffffff16565b50565b6000807f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050805491505090565b61282c6144e0565b81518351141515612872576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161286990615a1c565b60405180910390fd5b61287a6144e0565b8481600001818152505061288e8484613c24565b8160200181905250809150509392505050565b606060006128ae83613d3a565b90506060816040519080825280601f01601f1916602001820160405280156128e55781602001600182028038833980820191505090505b50905061290182828660000151613d559092919063ffffffff16565b60208203915061292082828660200151613d5f9092919063ffffffff16565b9150600082141515612967576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161295e906158dc565b60405180910390fd5b8092505050919050565b6001151561298b8583606a6135c59092919063ffffffff16565b15151415156129cf576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016129c690615bdc565b60405180910390fd5b6000806129db866118b7565b91509150600082111515612a24576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612a1b9061593c565b60405180910390fd5b6001821180612a3e575060011515612a3a6113f6565b1515145b80612a7b5750612a4c612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612abc576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ab3906159bc565b60405180910390fd5b600282101515612bc4576000612adc85606d611df990919063ffffffff16565b9050600060208260019004908060020a82049150509050612afb612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff161415612b3357612bc1565b60011515612b3f6113f6565b15151480612b7f5750612b50612010565b73ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16145b1515612bc0576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612bb790615a3c565b60405180910390fd5b5b50505b505050505050565b6000612be4838560030161376290919063ffffffff16565b151515612c26576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c1d906159dc565b60405180910390fd5b612c3c83856006016133df90919063ffffffff16565b151515612c7e576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c75906159dc565b60405180910390fd5b612c94838560090161378290919063ffffffff16565b151515612cd6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ccd906159dc565b60405180910390fd5b612cee838386600001613e1c9092919063ffffffff16565b90509392505050565b6000919050565b60011515612d188583606a6135c59092919063ffffffff16565b1515141515612d5c576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612d5390615b7c565b60405180910390fd5b600080612d68866118b7565b91509150600082111515612db1576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612da89061591c565b60405180910390fd5b6001821180612dcb575060011515612dc76113f6565b1515145b80612e085750612dd9612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612e49576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612e4090615afc565b60405180910390fd5b600282101515612f4a57612e5b6113f6565b80612e985750612e69612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15612ea257612f49565b6000612eb886606d611df990919063ffffffff16565b9050600060208260019004908060020a82049150509050612ed7612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16141515612f46576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612f3d90615c1c565b60405180910390fd5b50505b5b505050505050565b6000612f5e84846133df565b15612f9157612f8a82856000016000868152602001908152602001600020613e5790919063ffffffff16565b9050612f96565b600090505b9392505050565b6000806000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166392d66313426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016130199190615c5e565b60206040518083038186803b15801561303157600080fd5b505afa158015613045573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506130699190810190614daf565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1663a324ad24426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016130e49190615c5e565b60206040518083038186803b1580156130fc57600080fd5b505afa158015613110573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506131349190810190614e66565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166365c72840426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016131af9190615c5e565b60206040518083038186803b1580156131c757600080fd5b505afa1580156131db573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506131ff9190810190614e66565b90508261ffff168417935060108260ff169060020a028417935060188160ff169060020a028417935083604051602001808281526020019150506040516020818303038152906040528051906020012094505050505090565b6000606082600b01602060405190810160405280600081525091509150915091565b600060606132976020604051908101604052806000815250613f50565b915091509091565b60006132b78284600001613f6090919063ffffffff16565b806132d457506132d38284600301613fb290919063ffffffff16565b5b806132f157506132f0828460060161358c90919063ffffffff16565b5b8061330e575061330d828460090161400c90919063ffffffff16565b5b905092915050565b606061332e828460030161404590919063ffffffff16565b905092915050565b61333e6144e0565b60008251905061334c6144e0565b61335f828561414890919063ffffffff16565b816000018181525050602082039150613381828561415690919063ffffffff16565b8191508260200181945082905250506000821415156133d5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016133cc906158dc565b60405180910390fd5b8092505050919050565b60006133f7828460010161426190919063ffffffff16565b905092915050565b606061340b83836133df565b156134345761342d836000016000848152602001908152602001600020614284565b9050613468565b60006040519080825280602002602001820160405280156134645781602001602082028038833980820191505090505b5090505b92915050565b600060019054906101000a900460ff168061348d575061348c6125d0565b5b806134a457506000809054906101000a900460ff16155b15156134e5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016134dc90615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015613535576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b61353e82614321565b801561355f5760008060016101000a81548160ff0219169083151502179055505b5050565b50505050565b6000613583838386600601612f529092919063ffffffff16565b90509392505050565b600061359883836133df565b156135ba576135b38284600101613e5790919063ffffffff16565b90506135bf565b600090505b92915050565b60006135d184846133df565b15613604576135fd8285600001600086815260200190815260200160002061426190919063ffffffff16565b9050613609565b600090505b9392505050565b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151515613682576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016136799061595c565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a380603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b600061375a828460010161426190919063ffffffff16565b905092915050565b600061377a828460010161426190919063ffffffff16565b905092915050565b600061379a828460010161426190919063ffffffff16565b905092915050565b60006137ae8383613742565b15156137ef576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016137e690615bbc565b60405180910390fd5b82600001600083815260200190815260200160002054905092915050565b60006138198383614261565b151561386e578260010182908060018154018082558091505090600182039060005260206000200160009091929091909150558360000160008481526020019081526020016000208190555060019050613873565b600090505b92915050565b600060606000368080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509050600080369050905073ffffffffffffffffffffffffffffffffffffffff81830151169250829250505090565b600081846000016000858152602001908152602001600020908051906020019061391c9291906144fd565b50613933838560010161380d90919063ffffffff16565b90509392505050565b6000600482600381111561394c57fe5b60ff16101515613991576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161398890615b3c565b60405180910390fd5b6139a7838560000161374290919063ffffffff16565b1515156139e9576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016139e0906159dc565b60405180910390fd5b6139ff838560030161376290919063ffffffff16565b151515613a41576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a38906159dc565b60405180910390fd5b613a5783856006016133df90919063ffffffff16565b151515613a99576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a90906159dc565b60405180910390fd5b613aaf838560090161378290919063ffffffff16565b151515613af1576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ae8906159dc565b60405180910390fd5b816003811115613afd57fe5b60006003811115613b0a57fe5b1415613b2d57613b268385600601611ff090919063ffffffff16565b9050613c1d565b816003811115613b3957fe5b60016003811115613b4657fe5b1415613b6957613b62838560090161449a90919063ffffffff16565b9050613c1d565b816003811115613b7557fe5b60026003811115613b8257fe5b1415613bab57613ba483600060010286600001613e1c9092919063ffffffff16565b9050613c1d565b816003811115613bb757fe5b600380811115613bc357fe5b1415613c1c57613c158360006040519080825280601f01601f191660200182016040528015613c015781602001600182028038833980820191505090505b50866003016138f19092919063ffffffff16565b9050613c1d565b5b9392505050565b606081518351141515613c6c576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c6390615a1c565b60405180910390fd5b60608351604051908082528060200260200182016040528015613ca957816020015b613c9661457d565b815260200190600190039081613c8e5790505b50905060008090505b8451811015613d2f57613cc361459d565b8582815181101515613cd157fe5b906020019060200201518160000181815250508482815181101515613cf257fe5b90602001906020020151816020018181525050808383815181101515613d1457fe5b90602001906020020181905250508080600101915050613cb2565b508091505092915050565b6000613d4982602001516144ba565b60208001019050919050565b8282820152505050565b600080839050613d828184613d73886144ba565b6144c89092919063ffffffff16565b60208103905060008090505b8551811015613e1057613dc782858884815181101515613daa57fe5b9060200190602002015160000151613d559092919063ffffffff16565b602082039150613dfd82858884815181101515613de057fe5b9060200190602002015160200151613d559092919063ffffffff16565b6020820391508080600101915050613d8e565b50809150509392505050565b60008184600001600085815260200190815260200160002081905550613e4e838560010161380d90919063ffffffff16565b90509392505050565b6000613e638383614261565b15613f455760006001846000016000858152602001908152602001600020540390506000600185600101805490500390508181141515613efc5760008560010182815481101515613eb057fe5b90600052602060002001549050808660010184815481101515613ecf57fe5b90600052602060002001819055506001830186600001600083815260200190815260200160002081905550505b84600001600085815260200190815260200160002060009055846001018054801515613f2457fe5b60019003818190600052602060002001600090559055600192505050613f4a565b600090505b92915050565b6000606060008391509150915091565b6000613f6c8383613742565b15613fa75782600001600083815260200190815260200160002060009055613fa08284600101613e5790919063ffffffff16565b9050613fac565b600090505b92915050565b6000613fbe8383613762565b15614001578260000160008381526020019081526020016000206000613fe491906145bd565b613ffa8284600101613e5790919063ffffffff16565b9050614006565b600090505b92915050565b60006140188383613782565b1561403a576140338284600101613e5790919063ffffffff16565b905061403f565b600090505b92915050565b60606140518383613762565b1515614092576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161408990615bbc565b60405180910390fd5b8260000160008381526020019081526020016000208054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561413b5780601f106141105761010080835404028352916020019161413b565b820191906000526020600020905b81548152906001019060200180831161411e57829003601f168201915b5050505050905092915050565b600081830151905092915050565b6060600080839050600061417382876144d290919063ffffffff16565b9050602082039150600060408281151561418957fe5b0490506060816040519080825280602002602001820160405280156141c857816020015b6141b561457d565b8152602001906001900390816141ad5790505b50905060008090505b8281101561424f576141e161459d565b6141f4868b61414890919063ffffffff16565b816000018181525050602086039550614216868b61414890919063ffffffff16565b81602001818152505060208603955080838381518110151561423457fe5b906020019060200201819052505080806001019150506141d1565b50808495509550505050509250929050565b600080836000016000848152602001908152602001600020541415905092915050565b60608082600101805490506040519080825280602002602001820160405280156142bd5781602001602082028038833980820191505090505b50905060005b83600101805490508110156143175783600101818154811015156142e357fe5b906000526020600020015482828151811015156142fc57fe5b906020019060200201818152505080806001019150506142c3565b5080915050919050565b600061432b6127f3565b9050600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff161415151561439f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161439690615b1c565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515614410576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016144079061599c565b60405180910390fd5b8173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167fb9f84b8e65164b14439ae3620df0a4d8786d896996c0282b683f9d8c08f046e860405160405180910390a360007f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050828155505050565b60006144b2828460010161380d90919063ffffffff16565b905092915050565b600060408251029050919050565b8282820152505050565b600081830151905092915050565b604080519081016040528060008019168152602001606081525090565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061453e57805160ff191683800117855561456c565b8280016001018555821561456c579182015b8281111561456b578251825591602001919060010190614550565b5b5090506145799190614605565b5090565b604080519081016040528060008019168152602001600080191681525090565b604080519081016040528060008019168152602001600080191681525090565b50805460018160011615610100020316600290046000825580601f106145e35750614602565b601f0160209004906000526020600020908101906146019190614605565b5b50565b61462791905b8082111561462357600081600090555060010161460b565b5090565b90565b60006146368235615e98565b905092915050565b600061464a8235615eaa565b905092915050565b600082601f830112151561466557600080fd5b813561467861467382615d43565b615d16565b9150818183526020840193506020810190508385602084028201111561469d57600080fd5b60005b838110156146cd57816146b388826146eb565b8452602084019350602083019250506001810190506146a0565b5050505092915050565b60006146e38235615ebc565b905092915050565b60006146f78235615ec8565b905092915050565b60008083601f840112151561471357600080fd5b8235905067ffffffffffffffff81111561472c57600080fd5b60208301915083600182028301111561474457600080fd5b9250929050565b600082601f830112151561475e57600080fd5b813561477161476c82615d6b565b615d16565b9150808252602083016020830185838301111561478d57600080fd5b614798838284615f2d565b50505092915050565b60006147ad8251615ed2565b905092915050565b60006147c18235615ee0565b905092915050565b60006147d58251615ee0565b905092915050565b60006147e98235615eea565b905092915050565b60006147fd8251615eea565b905092915050565b60006020828403121561481757600080fd5b60006148258482850161462a565b91505092915050565b60006020828403121561484057600080fd5b600061484e8482850161463e565b91505092915050565b6000806040838503121561486a57600080fd5b60006148788582860161462a565b92505060206148898582860161462a565b9150509250929050565b60008060008060008060008060008060006101208c8e0312156148b557600080fd5b60006148c38e828f0161462a565b9b505060206148d48e828f0161462a565b9a505060408c013567ffffffffffffffff8111156148f157600080fd5b6148fd8e828f016146ff565b995099505060606149108e828f016147b5565b97505060806149218e828f016147b5565b96505060a06149328e828f016147b5565b95505060c06149438e828f016147b5565b94505060e08c013567ffffffffffffffff81111561496057600080fd5b61496c8e828f016146ff565b93509350506101006149808e828f016147b5565b9150509295989b509295989b9093969950565b6000602082840312156149a557600080fd5b60006149b3848285016146eb565b91505092915050565b600080604083850312156149cf57600080fd5b60006149dd858286016146eb565b92505060206149ee858286016146eb565b9150509250929050565b60008060008060808587031215614a0e57600080fd5b6000614a1c878288016146eb565b9450506020614a2d878288016146eb565b935050604085013567ffffffffffffffff811115614a4a57600080fd5b614a5687828801614652565b925050606085013567ffffffffffffffff811115614a7357600080fd5b614a7f87828801614652565b91505092959194509250565b600080600060608486031215614aa057600080fd5b6000614aae868287016146eb565b9350506020614abf868287016146eb565b9250506040614ad0868287016146eb565b9150509250925092565b60008060008060808587031215614af057600080fd5b6000614afe878288016146eb565b9450506020614b0f878288016146eb565b9350506040614b20878288016146eb565b9250506060614b31878288016146eb565b91505092959194509250565b600080600080600060a08688031215614b5557600080fd5b6000614b63888289016146eb565b9550506020614b74888289016146eb565b9450506040614b85888289016146eb565b9350506060614b96888289016146eb565b9250506080614ba7888289016146eb565b9150509295509295909350565b600080600080600060a08688031215614bcc57600080fd5b6000614bda888289016146eb565b9550506020614beb888289016146eb565b9450506040614bfc888289016146eb565b9350506060614c0d888289016146eb565b925050608086013567ffffffffffffffff811115614c2a57600080fd5b614c368882890161474b565b9150509295509295909350565b600080600080600060a08688031215614c5b57600080fd5b6000614c69888289016146eb565b9550506020614c7a888289016146eb565b9450506040614c8b888289016147dd565b935050606086013567ffffffffffffffff811115614ca857600080fd5b614cb488828901614652565b925050608086013567ffffffffffffffff811115614cd157600080fd5b614cdd88828901614652565b9150509295509295909350565b60008060208385031215614cfd57600080fd5b600083013567ffffffffffffffff811115614d1757600080fd5b614d23858286016146ff565b92509250509250929050565b600080600080600060808688031215614d4757600080fd5b600086013567ffffffffffffffff811115614d6157600080fd5b614d6d888289016146ff565b95509550506020614d80888289016146d7565b9350506040614d91888289016147b5565b9250506060614da2888289016146eb565b9150509295509295909350565b600060208284031215614dc157600080fd5b6000614dcf848285016147a1565b91505092915050565b600060208284031215614dea57600080fd5b6000614df8848285016147b5565b91505092915050565b600060208284031215614e1357600080fd5b6000614e21848285016147c9565b91505092915050565b60008060408385031215614e3d57600080fd5b6000614e4b858286016147b5565b9250506020614e5c8582860161463e565b9150509250929050565b600060208284031215614e7857600080fd5b6000614e86848285016147f1565b91505092915050565b614e9881615ef7565b82525050565b614ea781615e09565b82525050565b614eb681615df7565b82525050565b6000614ec782615db1565b808452602084019350614ed983615d97565b60005b82811015614f0b57614eef868351614f81565b614ef882615ddd565b9150602086019550600181019050614edc565b50849250505092915050565b6000614f2282615dbc565b808452602084019350614f3483615da4565b60005b82811015614f6657614f4a86835161572e565b614f5382615dea565b9150604086019550600181019050614f37565b50849250505092915050565b614f7b81615e1b565b82525050565b614f8a81615e27565b82525050565b614f9981615e31565b82525050565b6000614faa82615dc7565b808452614fbe816020860160208601615f3c565b614fc781615f6f565b602085010191505092915050565b6000614fe082615dd2565b808452614ff4816020860160208601615f3c565b614ffd81615f6f565b602085010191505092915050565b6000601c82527f456e636f64696e67204572726f723a206f666673657420213d20302e000000006020830152604082019050919050565b6000602682527f47534e426f756e636572426173653a2063616c6c6572206973206e6f7420526560208301527f6c617948756200000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65006020830152604082019050919050565b6000601a82527f43616e6e6f74205550444154452073797374656d207461626c650000000000006020830152604082019050919050565b6000602682527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160208301527f64647265737300000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65006020830152604082019050919050565b6000602b82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f63757272656e74206f6e650000000000000000000000000000000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20555044415445206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602082527f4572726f723a206b65792065786973747320696e206f7468657220646963742e6020830152604082019050919050565b6000601582527f726f7720616c726561647920686173206f776e657200000000000000000000006020830152604082019050919050565b6000601082527f4572726f7220616c69676e6d656e742e000000000000000000000000000000006020830152604082019050919050565b6000603982527f4e6f7420726f774f776e6572206f72206f776e65722f64656c6567617465206660208301527f6f722055504441544520696e746f2074686973207461626c65000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20494e53455254206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000601282527f6572726f722072656d6f76696e67206b657900000000000000000000000000006020830152604082019050919050565b6000602082527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726020830152604082019050919050565b6000602e82527f436f6e747261637420696e7374616e63652068617320616c726561647920626560208301527f656e20696e697469616c697a65640000000000000000000000000000000000006040830152606082019050919050565b6000601782527f69642b6669656c6420616c7265616479206578697374730000000000000000006020830152604082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e2044454c455445206660208301527f726f6d2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602c82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f7a65726f206164647265737300000000000000000000000000000000000000006040830152606082019050919050565b6000601382527f496e76616c6964207461626c65207479706521000000000000000000000000006020830152604082019050919050565b6000601482527f5461626c6520616c7265616479206578697374730000000000000000000000006020830152604082019050919050565b6000601082527f696420646f65736e2774206578697374000000000000000000000000000000006020830152604082019050919050565b6000601182527f7461626c65206e6f7420637265617465640000000000000000000000000000006020830152604082019050919050565b6000601382527f4b657920646f6573206e6f7420657869737421000000000000000000000000006020830152604082019050919050565b6000601c82527f696420646f65736e27742065786973742c2075736520494e53455254000000006020830152604082019050919050565b6000601482527f7461626c6520646f6573206e6f742065786973740000000000000000000000006020830152604082019050919050565b6000601782527f53656e646572206e6f74206f776e6572206f6620726f770000000000000000006020830152604082019050919050565b6040820160008201516157446000850182614f81565b5060208201516157576020850182614f81565b50505050565b60006040830160008301516157756000860182614f81565b506020830151848203602086015261578d8282614f17565b9150508091505092915050565b6157a381615e7d565b82525050565b6157b281615e87565b82525050565b60006020820190506157cd6000830184614ead565b92915050565b60006020820190506157e86000830184614e8f565b92915050565b60006040820190506158036000830185614ead565b6158106020830184614f90565b9392505050565b600060208201905081810360008301526158318184614ebc565b905092915050565b600060208201905061584e6000830184614f72565b92915050565b60006020820190506158696000830184614f81565b92915050565b60006040820190506158846000830185614f81565b6158916020830184614ead565b9392505050565b600060208201905081810360008301526158b28184614f9f565b905092915050565b600060208201905081810360008301526158d48184614fd5565b905092915050565b600060208201905081810360008301526158f58161500b565b9050919050565b6000602082019050818103600083015261591581615042565b9050919050565b600060208201905081810360008301526159358161509f565b9050919050565b60006020820190508181036000830152615955816150d6565b9050919050565b600060208201905081810360008301526159758161510d565b9050919050565b600060208201905081810360008301526159958161516a565b9050919050565b600060208201905081810360008301526159b5816151a1565b9050919050565b600060208201905081810360008301526159d5816151fe565b9050919050565b600060208201905081810360008301526159f58161525b565b9050919050565b60006020820190508181036000830152615a1581615292565b9050919050565b60006020820190508181036000830152615a35816152c9565b9050919050565b60006020820190508181036000830152615a5581615300565b9050919050565b60006020820190508181036000830152615a758161535d565b9050919050565b60006020820190508181036000830152615a95816153ba565b9050919050565b60006020820190508181036000830152615ab5816153f1565b9050919050565b60006020820190508181036000830152615ad581615428565b9050919050565b60006020820190508181036000830152615af581615485565b9050919050565b60006020820190508181036000830152615b15816154bc565b9050919050565b60006020820190508181036000830152615b3581615519565b9050919050565b60006020820190508181036000830152615b5581615576565b9050919050565b60006020820190508181036000830152615b75816155ad565b9050919050565b60006020820190508181036000830152615b95816155e4565b9050919050565b60006020820190508181036000830152615bb58161561b565b9050919050565b60006020820190508181036000830152615bd581615652565b9050919050565b60006020820190508181036000830152615bf581615689565b9050919050565b60006020820190508181036000830152615c15816156c0565b9050919050565b60006020820190508181036000830152615c35816156f7565b9050919050565b60006020820190508181036000830152615c56818461575d565b905092915050565b6000602082019050615c73600083018461579a565b92915050565b6000604082019050615c8e600083018561579a565b615c9b6020830184614ead565b9392505050565b6000604082019050615cb7600083018561579a565b615cc46020830184614e9e565b9392505050565b6000604082019050615ce0600083018561579a565b8181036020830152615cf28184614f9f565b90509392505050565b6000602082019050615d1060008301846157a9565b92915050565b6000604051905081810181811067ffffffffffffffff82111715615d3957600080fd5b8060405250919050565b600067ffffffffffffffff821115615d5a57600080fd5b602082029050602081019050919050565b600067ffffffffffffffff821115615d8257600080fd5b601f19601f8301169050602081019050919050565b6000602082019050919050565b6000602082019050919050565b600081519050919050565b600081519050919050565b600081519050919050565b600081519050919050565b6000602082019050919050565b6000602082019050919050565b6000615e0282615e5d565b9050919050565b6000615e1482615e5d565b9050919050565b60008115159050919050565b6000819050919050565b60007fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000819050919050565b600064ffffffffff82169050919050565b6000615ea382615e5d565b9050919050565b6000615eb582615e5d565b9050919050565b60008115159050919050565b6000819050919050565b600061ffff82169050919050565b6000819050919050565b600060ff82169050919050565b6000615f0282615f09565b9050919050565b6000615f1482615f1b565b9050919050565b6000615f2682615e5d565b9050919050565b82818337600083830152505050565b60005b83811015615f5a578082015181840152602081019050615f3f565b83811115615f69576000848401525b50505050565b6000601f19601f830116905091905056fea265627a7a723058209bcb1bf16a1085306655d0c2d5d93b34418da7f8b6e9188bde2d9bd1571f27896c6578706572696d656e74616cf50037";
var deployedBytecode = "0x6080604052600436106101b6576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168062f714ce146101b857806301ee810a146101e15780631fd6dda51461020c57806328343c3414610249578063287e724614610274578063365628a2146102b25780633c2e8599146102db5780633ffe300e146103065780634102fbf61461032f578063485cc9551461035a57806359cb73a4146103835780636729003c146103c0578063715018a6146103fd57806374e861d6146104145780637af9c6631461043f5780637e03a8241461047c57806380274db7146104a55780638175d7eb146104e257806383947ea01461050b5780638d3178cc146105495780638da5cb5b146105725780638f32d59b1461059d578063a2ea7c6e146105c8578063ad61ccd514610605578063b467949b14610630578063bc41c3dd14610659578063c2309bf914610682578063c4d66de8146106bf578063d887f105146106e8578063e06e0e2214610726578063e3c504e41461074f578063ed90cb371461078c578063f201fe2a146107b5578063f2fde38b146107f2578063fa09e6301461081b575b005b3480156101c457600080fd5b506101df60048036036101da9190810190614e2a565b610858565b005b3480156101ed57600080fd5b506101f661093a565b6040516102039190615cfb565b60405180910390f35b34801561021857600080fd5b50610233600480360361022e9190810190614993565b610951565b6040516102409190615839565b60405180910390f35b34801561025557600080fd5b5061025e61096e565b60405161026b9190615817565b60405180910390f35b34801561028057600080fd5b5061029b60048036036102969190810190614993565b6109ac565b6040516102a99291906157ee565b60405180910390f35b3480156102be57600080fd5b506102d960048036036102d49190810190614c43565b610a02565b005b3480156102e757600080fd5b506102f0610b1a565b6040516102fd9190615c5e565b60405180910390f35b34801561031257600080fd5b5061032d60048036036103289190810190614bb4565b610bcd565b005b34801561033b57600080fd5b50610344610da1565b6040516103519190615854565b60405180910390f35b34801561036657600080fd5b50610381600480360361037c9190810190614857565b610dc8565b005b34801561038f57600080fd5b506103aa60048036036103a59190810190614993565b610f10565b6040516103b79190615c5e565b60405180910390f35b3480156103cc57600080fd5b506103e760048036036103e29190810190614993565b610f28565b6040516103f49190615854565b60405180910390f35b34801561040957600080fd5b50610412610f6b565b005b34801561042057600080fd5b50610429611075565b60405161043691906157b8565b60405180910390f35b34801561044b57600080fd5b50610466600480360361046191908101906149f8565b611084565b6040516104739190615839565b60405180910390f35b34801561048857600080fd5b506104a3600480360361049e9190810190614b3d565b611113565b005b3480156104b157600080fd5b506104cc60048036036104c79190810190614cea565b6111a6565b6040516104d99190615854565b60405180910390f35b3480156104ee57600080fd5b5061050960048036036105049190810190614a8b565b611274565b005b34801561051757600080fd5b50610532600480360361052d9190810190614893565b6112b3565b604051610540929190615ccb565b60405180910390f35b34801561055557600080fd5b50610570600480360361056b9190810190614ada565b611332565b005b34801561057e57600080fd5b506105876113cc565b60405161059491906157b8565b60405180910390f35b3480156105a957600080fd5b506105b26113f6565b6040516105bf9190615839565b60405180910390f35b3480156105d457600080fd5b506105ef60048036036105ea9190810190614993565b611455565b6040516105fc9190615c3c565b60405180910390f35b34801561061157600080fd5b5061061a611486565b60405161062791906158ba565b60405180910390f35b34801561063c57600080fd5b5061065760048036036106529190810190614b3d565b6114c3565b005b34801561066557600080fd5b50610680600480360361067b9190810190614dd8565b6116da565b005b34801561068e57600080fd5b506106a960048036036106a49190810190614993565b611749565b6040516106b69190615817565b60405180910390f35b3480156106cb57600080fd5b506106e660048036036106e19190810190614805565b6117c2565b005b3480156106f457600080fd5b5061070f600480360361070a9190810190614993565b6118b7565b60405161071d929190615c79565b60405180910390f35b34801561073257600080fd5b5061074d60048036036107489190810190614d2f565b61194c565b005b34801561075b57600080fd5b5061077660048036036107719190810190614993565b611a1a565b6040516107839190615898565b60405180910390f35b34801561079857600080fd5b506107b360048036036107ae91908101906149bc565b611a8d565b005b3480156107c157600080fd5b506107dc60048036036107d791908101906149bc565b611b45565b6040516107e99190615839565b60405180910390f35b3480156107fe57600080fd5b5061081960048036036108149190810190614805565b611b65565b005b34801561082757600080fd5b50610842600480360361083d919081019061482e565b611bba565b60405161084f9190615c5e565b60405180910390f35b6108606113f6565b15156108a1576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161089890615a9c565b60405180910390fd5b60006108ab611d53565b90508073ffffffffffffffffffffffffffffffffffffffff1662f714ce84846040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610903929190615ca2565b600060405180830381600087803b15801561091d57600080fd5b505af1158015610931573d6000803e3d6000fd5b50505050505050565b606860009054906101000a900464ffffffffff1681565b600061096782606d611d6290919063ffffffff16565b9050919050565b60606109a77f736368656d61732e7075626c69632e7461626c65730000000000000000000000600102606d611dd990919063ffffffff16565b905090565b60008060006109c584606d611df990919063ffffffff16565b600190049050807c0100000000000000000000000000000000000000000000000000000000029150602081908060020a8204915050925050915091565b610a0a6113f6565b1515610a4b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a4290615a9c565b60405180910390fd5b60006001026069600086815260200190815260200160002054141515610aa6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610a9d90615b5c565b60405180910390fd5b6000809050610ab6858583611e19565b610aef7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010287606d611ec59092919063ffffffff16565b50610b0485606a611ff090919063ffffffff16565b50610b1186868585611084565b50505050505050565b6000610b24611d53565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401610b7891906157d3565b60206040518083038186803b158015610b9057600080fd5b505afa158015610ba4573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250610bc89190810190614e01565b905090565b84600080610bda836118b7565b91509150600082111515610c23576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610c1a9061597c565b60405180910390fd5b6001821180610c3d575060011515610c396113f6565b1515145b80610c7a5750610c4b612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515610cbb576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610cb290615a5c565b60405180910390fd5b6000610cc7888a612064565b90506000610cd58883612064565b905060001515610cef82606d611d6290919063ffffffff16565b1515141515610d33576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610d2a90615adc565b60405180910390fd5b610d3b6120c1565b610d518a88606a6121049092919063ffffffff16565b5060001515610d6a83606d611d6290919063ffffffff16565b15151415610d7e57610d7d82888c61214f565b5b610d948187606d6124a59092919063ffffffff16565b5050505050505050505050565b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010281565b600060019054906101000a900460ff1680610de75750610de66125d0565b5b80610dfe57506000809054906101000a900460ff16155b1515610e3f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610e3690615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015610e8f576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81606660006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550610ed9336125e7565b610ee2836117c2565b610eea612791565b8015610f0b5760008060016101000a81548160ff0219169083151502179055505b505050565b60676020528060005260406000206000915090505481565b6000610f3e82606d611d6290919063ffffffff16565b15610f5e57610f5782606d611df990919063ffffffff16565b9050610f66565b600060010290505b919050565b610f736113f6565b1515610fb4576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610fab90615a9c565b60405180910390fd5b600073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a36000603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550565b600061107f6127f3565b905090565b600061108e6113f6565b15156110cf576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016110c690615a9c565b60405180910390fd5b6110d76144e0565b6110e2868585612824565b905060606110ef826128a1565b90506111078682606d6124a59092919063ffffffff16565b92505050949350505050565b600061111f8587612064565b9050600061112d8583612064565b905061113b87878487612971565b6111436120c1565b6111598184606d612bcc9092919063ffffffff16565b508285887f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b7187611187612010565b60405161119592919061586f565b60405180910390a450505050505050565b60006111b0611075565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151561121f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611216906158fc565b60405180910390fd5b61126c83838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050612cf7565b905092915050565b60006112808385612064565b905061128e84828585612cfe565b6112966120c1565b6112ac8483606a612f529092919063ffffffff16565b5050505050565b6000606060006112c1612f9d565b9050600060676000838152602001908152602001600020549050606860009054906101000a900464ffffffffff1664ffffffffff1681101515611313576113086002613258565b935093505050611322565b61131b61327a565b9350935050505b9b509b9950505050505050505050565b600061133e8486612064565b9050600061134c8483612064565b905061135a86838786612cfe565b6113626120c1565b600061137882606d61329f90919063ffffffff16565b9050600115158115151415156113c3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016113ba90615a7c565b60405180910390fd5b50505050505050565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16905090565b6000603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16611439612010565b73ffffffffffffffffffffffffffffffffffffffff1614905090565b61145d6144e0565b606061147383606d61331690919063ffffffff16565b905061147e81613336565b915050919050565b60606040805190810160405280600581526020017f312e302e30000000000000000000000000000000000000000000000000000000815250905090565b846000806114d0836118b7565b91509150600082111515611519576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115109061597c565b60405180910390fd5b600182118061153357506001151561152f6113f6565b1515145b806115705750611541612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15156115b1576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115a890615a5c565b60405180910390fd5b60006115bd888a612064565b905060006115cb8883612064565b9050600015156115e582606d611d6290919063ffffffff16565b1515141515611629576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161162090615adc565b60405180910390fd5b6116316120c1565b6116478a88606a6121049092919063ffffffff16565b506000151561166083606d611d6290919063ffffffff16565b151514156116745761167382888c61214f565b5b61168a8187606d612bcc9092919063ffffffff16565b5085888b7f73f74243127530ba96dc00b266dfa2b8da17d2b0489b55f8f947074436f23b718a6116b8612010565b6040516116c692919061586f565b60405180910390a450505050505050505050565b6116e26113f6565b1515611723576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161171a90615a9c565b60405180910390fd5b80606860006101000a81548164ffffffffff021916908364ffffffffff16021790555050565b60606001151561176383606a6133df90919063ffffffff16565b15151415156117a7576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161179e90615b9c565b60405180910390fd5b6117bb82606a6133ff90919063ffffffff16565b9050919050565b600060019054906101000a900460ff16806117e157506117e06125d0565b5b806117f857506000809054906101000a900460ff16155b1515611839576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161183090615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015611889576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b6118928261346e565b80156118b35760008060016101000a81548160ff0219169083151502179055505b5050565b60008060006001026069600085815260200190815260200160002054111515611915576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161190c90615bfc565b60405180910390fd5b600060696000858152602001908152602001600020546001900490508060ff169250600881908060020a8204915050915050915091565b611954611075565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161415156119c3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016119ba906158fc565b60405180910390fd5b611a1385858080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f82011690508083019250505050505050848484613563565b5050505050565b6060611a3082606d611d6290919063ffffffff16565b15611a5057611a4982606d61331690919063ffffffff16565b9050611a88565b60006040519080825280601f01601f191660200182016040528015611a845781602001600182028038833980820191505090505b5090505b919050565b611a956113f6565b1515611ad6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611acd90615a9c565b60405180910390fd5b60006001026069600083815260200190815260200160002081905550611b2b7f736368656d61732e7075626c69632e7461626c6573000000000000000000000060010283606d6135699092919063ffffffff16565b50611b4081606a61358c90919063ffffffff16565b505050565b6000611b5d8383606a6135c59092919063ffffffff16565b905092915050565b611b6d6113f6565b1515611bae576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611ba590615a9c565b60405180910390fd5b611bb781613610565b50565b6000611bc46113f6565b1515611c05576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611bfc90615a9c565b60405180910390fd5b6000611c0f611d53565b90506000611c1b611d53565b73ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611c6f91906157d3565b60206040518083038186803b158015611c8757600080fd5b505afa158015611c9b573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611cbf9190810190614e01565b90508173ffffffffffffffffffffffffffffffffffffffff1662f714ce82866040518363ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401611d17929190615ca2565b600060405180830381600087803b158015611d3157600080fd5b505af1158015611d45573d6000803e3d6000fd5b505050508092505050919050565b6000611d5d6127f3565b905090565b6000611d7a828460000161374290919063ffffffff16565b80611d975750611d96828460030161376290919063ffffffff16565b5b80611db45750611db382846006016133df90919063ffffffff16565b5b80611dd15750611dd0828460090161378290919063ffffffff16565b5b905092915050565b6060611df182846006016133ff90919063ffffffff16565b905092915050565b6000611e1182846000016137a290919063ffffffff16565b905092915050565b611e216113f6565b1515611e62576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611e5990615a9c565b60405180910390fd5b60008260ff168117905060088273ffffffffffffffffffffffffffffffffffffffff169060020a0273ffffffffffffffffffffffffffffffffffffffff168117905080600102606960008681526020019081526020016000208190555050505050565b6000611edd838560000161374290919063ffffffff16565b151515611f1f576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611f16906159dc565b60405180910390fd5b611f35838560030161376290919063ffffffff16565b151515611f77576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611f6e906159dc565b60405180910390fd5b611f8d838560090161378290919063ffffffff16565b151515611fcf576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401611fc6906159dc565b60405180910390fd5b611fe78383866006016121049092919063ffffffff16565b90509392505050565b6000612008828460010161380d90919063ffffffff16565b905092915050565b600061201a6127f3565b73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614151561205657339050612061565b61205e613879565b90505b90565b60006060604080519080825280601f01601f19166020018201604052801561209b5781602001600182028038833980820191505090505b509050836040820152826020820152600081805190602001209050809250505092915050565b60006120cb612f9d565b90506000606760008381526020019081526020016000205490506001810160676000848152602001908152602001600020819055505050565b600061211084846133df565b156121435761213c8285600001600086815260200190815260200160002061380d90919063ffffffff16565b9050612148565b600090505b9392505050565b6000151561216784606d611d6290919063ffffffff16565b15151415156121ab576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016121a2906159fc565b60405180910390fd5b600080606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166392d66313426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016122259190615c5e565b60206040518083038186803b15801561223d57600080fd5b505afa158015612251573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506122759190810190614daf565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1663a324ad24426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016122f09190615c5e565b60206040518083038186803b15801561230857600080fd5b505afa15801561231c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506123409190810190614e66565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166365c72840426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016123bb9190615c5e565b60206040518083038186803b1580156123d357600080fd5b505afa1580156123e7573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525061240b9190810190614e66565b90508261ffff168417935060108260ff169060020a028417935060188160ff169060020a02841793506000847c01000000000000000000000000000000000000000000000000000000000290506020612462612010565b73ffffffffffffffffffffffffffffffffffffffff169060020a028517945061249a8886600102606d612bcc9092919063ffffffff16565b505050505050505050565b60006124bd838560000161374290919063ffffffff16565b1515156124ff576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016124f6906159dc565b60405180910390fd5b61251583856006016133df90919063ffffffff16565b151515612557576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161254e906159dc565b60405180910390fd5b61256d838560090161378290919063ffffffff16565b1515156125af576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016125a6906159dc565b60405180910390fd5b6125c78383866003016138f19092919063ffffffff16565b90509392505050565b6000803090506000813b9050600081149250505090565b600060019054906101000a900460ff168061260657506126056125d0565b5b8061261d57506000809054906101000a900460ff16155b151561265e576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161265590615abc565b60405180910390fd5b60008060019054906101000a900460ff1615905080156126ae576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b81603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16600073ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a3801561278d5760008060016101000a81548160ff0219169083151502179055505b5050565b6103e8606860006101000a81548164ffffffffff021916908364ffffffffff1602179055506127f07f736368656d61732e7075626c69632e7461626c657300000000000000000000006001026000606d61393c9092919063ffffffff16565b50565b6000807f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050805491505090565b61282c6144e0565b81518351141515612872576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161286990615a1c565b60405180910390fd5b61287a6144e0565b8481600001818152505061288e8484613c24565b8160200181905250809150509392505050565b606060006128ae83613d3a565b90506060816040519080825280601f01601f1916602001820160405280156128e55781602001600182028038833980820191505090505b50905061290182828660000151613d559092919063ffffffff16565b60208203915061292082828660200151613d5f9092919063ffffffff16565b9150600082141515612967576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161295e906158dc565b60405180910390fd5b8092505050919050565b6001151561298b8583606a6135c59092919063ffffffff16565b15151415156129cf576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016129c690615bdc565b60405180910390fd5b6000806129db866118b7565b91509150600082111515612a24576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612a1b9061593c565b60405180910390fd5b6001821180612a3e575060011515612a3a6113f6565b1515145b80612a7b5750612a4c612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612abc576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ab3906159bc565b60405180910390fd5b600282101515612bc4576000612adc85606d611df990919063ffffffff16565b9050600060208260019004908060020a82049150509050612afb612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff161415612b3357612bc1565b60011515612b3f6113f6565b15151480612b7f5750612b50612010565b73ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16145b1515612bc0576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612bb790615a3c565b60405180910390fd5b5b50505b505050505050565b6000612be4838560030161376290919063ffffffff16565b151515612c26576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c1d906159dc565b60405180910390fd5b612c3c83856006016133df90919063ffffffff16565b151515612c7e576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612c75906159dc565b60405180910390fd5b612c94838560090161378290919063ffffffff16565b151515612cd6576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612ccd906159dc565b60405180910390fd5b612cee838386600001613e1c9092919063ffffffff16565b90509392505050565b6000919050565b60011515612d188583606a6135c59092919063ffffffff16565b1515141515612d5c576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612d5390615b7c565b60405180910390fd5b600080612d68866118b7565b91509150600082111515612db1576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612da89061591c565b60405180910390fd5b6001821180612dcb575060011515612dc76113f6565b1515145b80612e085750612dd9612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b1515612e49576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612e4090615afc565b60405180910390fd5b600282101515612f4a57612e5b6113f6565b80612e985750612e69612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b15612ea257612f49565b6000612eb886606d611df990919063ffffffff16565b9050600060208260019004908060020a82049150509050612ed7612010565b73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16141515612f46576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401612f3d90615c1c565b60405180910390fd5b50505b5b505050505050565b6000612f5e84846133df565b15612f9157612f8a82856000016000868152602001908152602001600020613e5790919063ffffffff16565b9050612f96565b600090505b9392505050565b6000806000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166392d66313426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016130199190615c5e565b60206040518083038186803b15801561303157600080fd5b505afa158015613045573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506130699190810190614daf565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1663a324ad24426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016130e49190615c5e565b60206040518083038186803b1580156130fc57600080fd5b505afa158015613110573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506131349190810190614e66565b90506000606660009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166365c72840426040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004016131af9190615c5e565b60206040518083038186803b1580156131c757600080fd5b505afa1580156131db573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506131ff9190810190614e66565b90508261ffff168417935060108260ff169060020a028417935060188160ff169060020a028417935083604051602001808281526020019150506040516020818303038152906040528051906020012094505050505090565b6000606082600b01602060405190810160405280600081525091509150915091565b600060606132976020604051908101604052806000815250613f50565b915091509091565b60006132b78284600001613f6090919063ffffffff16565b806132d457506132d38284600301613fb290919063ffffffff16565b5b806132f157506132f0828460060161358c90919063ffffffff16565b5b8061330e575061330d828460090161400c90919063ffffffff16565b5b905092915050565b606061332e828460030161404590919063ffffffff16565b905092915050565b61333e6144e0565b60008251905061334c6144e0565b61335f828561414890919063ffffffff16565b816000018181525050602082039150613381828561415690919063ffffffff16565b8191508260200181945082905250506000821415156133d5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016133cc906158dc565b60405180910390fd5b8092505050919050565b60006133f7828460010161426190919063ffffffff16565b905092915050565b606061340b83836133df565b156134345761342d836000016000848152602001908152602001600020614284565b9050613468565b60006040519080825280602002602001820160405280156134645781602001602082028038833980820191505090505b5090505b92915050565b600060019054906101000a900460ff168061348d575061348c6125d0565b5b806134a457506000809054906101000a900460ff16155b15156134e5576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016134dc90615abc565b60405180910390fd5b60008060019054906101000a900460ff161590508015613535576001600060016101000a81548160ff02191690831515021790555060016000806101000a81548160ff0219169083151502179055505b61353e82614321565b801561355f5760008060016101000a81548160ff0219169083151502179055505b5050565b50505050565b6000613583838386600601612f529092919063ffffffff16565b90509392505050565b600061359883836133df565b156135ba576135b38284600101613e5790919063ffffffff16565b90506135bf565b600090505b92915050565b60006135d184846133df565b15613604576135fd8285600001600086815260200190815260200160002061426190919063ffffffff16565b9050613609565b600090505b9392505050565b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614151515613682576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016136799061595c565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff16603360009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e060405160405180910390a380603360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b600061375a828460010161426190919063ffffffff16565b905092915050565b600061377a828460010161426190919063ffffffff16565b905092915050565b600061379a828460010161426190919063ffffffff16565b905092915050565b60006137ae8383613742565b15156137ef576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016137e690615bbc565b60405180910390fd5b82600001600083815260200190815260200160002054905092915050565b60006138198383614261565b151561386e578260010182908060018154018082558091505090600182039060005260206000200160009091929091909150558360000160008481526020019081526020016000208190555060019050613873565b600090505b92915050565b600060606000368080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509050600080369050905073ffffffffffffffffffffffffffffffffffffffff81830151169250829250505090565b600081846000016000858152602001908152602001600020908051906020019061391c9291906144fd565b50613933838560010161380d90919063ffffffff16565b90509392505050565b6000600482600381111561394c57fe5b60ff16101515613991576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161398890615b3c565b60405180910390fd5b6139a7838560000161374290919063ffffffff16565b1515156139e9576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016139e0906159dc565b60405180910390fd5b6139ff838560030161376290919063ffffffff16565b151515613a41576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a38906159dc565b60405180910390fd5b613a5783856006016133df90919063ffffffff16565b151515613a99576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613a90906159dc565b60405180910390fd5b613aaf838560090161378290919063ffffffff16565b151515613af1576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613ae8906159dc565b60405180910390fd5b816003811115613afd57fe5b60006003811115613b0a57fe5b1415613b2d57613b268385600601611ff090919063ffffffff16565b9050613c1d565b816003811115613b3957fe5b60016003811115613b4657fe5b1415613b6957613b62838560090161449a90919063ffffffff16565b9050613c1d565b816003811115613b7557fe5b60026003811115613b8257fe5b1415613bab57613ba483600060010286600001613e1c9092919063ffffffff16565b9050613c1d565b816003811115613bb757fe5b600380811115613bc357fe5b1415613c1c57613c158360006040519080825280601f01601f191660200182016040528015613c015781602001600182028038833980820191505090505b50866003016138f19092919063ffffffff16565b9050613c1d565b5b9392505050565b606081518351141515613c6c576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401613c6390615a1c565b60405180910390fd5b60608351604051908082528060200260200182016040528015613ca957816020015b613c9661457d565b815260200190600190039081613c8e5790505b50905060008090505b8451811015613d2f57613cc361459d565b8582815181101515613cd157fe5b906020019060200201518160000181815250508482815181101515613cf257fe5b90602001906020020151816020018181525050808383815181101515613d1457fe5b90602001906020020181905250508080600101915050613cb2565b508091505092915050565b6000613d4982602001516144ba565b60208001019050919050565b8282820152505050565b600080839050613d828184613d73886144ba565b6144c89092919063ffffffff16565b60208103905060008090505b8551811015613e1057613dc782858884815181101515613daa57fe5b9060200190602002015160000151613d559092919063ffffffff16565b602082039150613dfd82858884815181101515613de057fe5b9060200190602002015160200151613d559092919063ffffffff16565b6020820391508080600101915050613d8e565b50809150509392505050565b60008184600001600085815260200190815260200160002081905550613e4e838560010161380d90919063ffffffff16565b90509392505050565b6000613e638383614261565b15613f455760006001846000016000858152602001908152602001600020540390506000600185600101805490500390508181141515613efc5760008560010182815481101515613eb057fe5b90600052602060002001549050808660010184815481101515613ecf57fe5b90600052602060002001819055506001830186600001600083815260200190815260200160002081905550505b84600001600085815260200190815260200160002060009055846001018054801515613f2457fe5b60019003818190600052602060002001600090559055600192505050613f4a565b600090505b92915050565b6000606060008391509150915091565b6000613f6c8383613742565b15613fa75782600001600083815260200190815260200160002060009055613fa08284600101613e5790919063ffffffff16565b9050613fac565b600090505b92915050565b6000613fbe8383613762565b15614001578260000160008381526020019081526020016000206000613fe491906145bd565b613ffa8284600101613e5790919063ffffffff16565b9050614006565b600090505b92915050565b60006140188383613782565b1561403a576140338284600101613e5790919063ffffffff16565b905061403f565b600090505b92915050565b60606140518383613762565b1515614092576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161408990615bbc565b60405180910390fd5b8260000160008381526020019081526020016000208054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561413b5780601f106141105761010080835404028352916020019161413b565b820191906000526020600020905b81548152906001019060200180831161411e57829003601f168201915b5050505050905092915050565b600081830151905092915050565b6060600080839050600061417382876144d290919063ffffffff16565b9050602082039150600060408281151561418957fe5b0490506060816040519080825280602002602001820160405280156141c857816020015b6141b561457d565b8152602001906001900390816141ad5790505b50905060008090505b8281101561424f576141e161459d565b6141f4868b61414890919063ffffffff16565b816000018181525050602086039550614216868b61414890919063ffffffff16565b81602001818152505060208603955080838381518110151561423457fe5b906020019060200201819052505080806001019150506141d1565b50808495509550505050509250929050565b600080836000016000848152602001908152602001600020541415905092915050565b60608082600101805490506040519080825280602002602001820160405280156142bd5781602001602082028038833980820191505090505b50905060005b83600101805490508110156143175783600101818154811015156142e357fe5b906000526020600020015482828151811015156142fc57fe5b906020019060200201818152505080806001019150506142c3565b5080915050919050565b600061432b6127f3565b9050600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff161415151561439f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161439690615b1c565b60405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1614151515614410576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016144079061599c565b60405180910390fd5b8173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff167fb9f84b8e65164b14439ae3620df0a4d8786d896996c0282b683f9d8c08f046e860405160405180910390a360007f06b7792c761dcc05af1761f0315ce8b01ac39c16cc934eb0b2f7a8e71414f2626001029050828155505050565b60006144b2828460010161380d90919063ffffffff16565b905092915050565b600060408251029050919050565b8282820152505050565b600081830151905092915050565b604080519081016040528060008019168152602001606081525090565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061453e57805160ff191683800117855561456c565b8280016001018555821561456c579182015b8281111561456b578251825591602001919060010190614550565b5b5090506145799190614605565b5090565b604080519081016040528060008019168152602001600080191681525090565b604080519081016040528060008019168152602001600080191681525090565b50805460018160011615610100020316600290046000825580601f106145e35750614602565b601f0160209004906000526020600020908101906146019190614605565b5b50565b61462791905b8082111561462357600081600090555060010161460b565b5090565b90565b60006146368235615e98565b905092915050565b600061464a8235615eaa565b905092915050565b600082601f830112151561466557600080fd5b813561467861467382615d43565b615d16565b9150818183526020840193506020810190508385602084028201111561469d57600080fd5b60005b838110156146cd57816146b388826146eb565b8452602084019350602083019250506001810190506146a0565b5050505092915050565b60006146e38235615ebc565b905092915050565b60006146f78235615ec8565b905092915050565b60008083601f840112151561471357600080fd5b8235905067ffffffffffffffff81111561472c57600080fd5b60208301915083600182028301111561474457600080fd5b9250929050565b600082601f830112151561475e57600080fd5b813561477161476c82615d6b565b615d16565b9150808252602083016020830185838301111561478d57600080fd5b614798838284615f2d565b50505092915050565b60006147ad8251615ed2565b905092915050565b60006147c18235615ee0565b905092915050565b60006147d58251615ee0565b905092915050565b60006147e98235615eea565b905092915050565b60006147fd8251615eea565b905092915050565b60006020828403121561481757600080fd5b60006148258482850161462a565b91505092915050565b60006020828403121561484057600080fd5b600061484e8482850161463e565b91505092915050565b6000806040838503121561486a57600080fd5b60006148788582860161462a565b92505060206148898582860161462a565b9150509250929050565b60008060008060008060008060008060006101208c8e0312156148b557600080fd5b60006148c38e828f0161462a565b9b505060206148d48e828f0161462a565b9a505060408c013567ffffffffffffffff8111156148f157600080fd5b6148fd8e828f016146ff565b995099505060606149108e828f016147b5565b97505060806149218e828f016147b5565b96505060a06149328e828f016147b5565b95505060c06149438e828f016147b5565b94505060e08c013567ffffffffffffffff81111561496057600080fd5b61496c8e828f016146ff565b93509350506101006149808e828f016147b5565b9150509295989b509295989b9093969950565b6000602082840312156149a557600080fd5b60006149b3848285016146eb565b91505092915050565b600080604083850312156149cf57600080fd5b60006149dd858286016146eb565b92505060206149ee858286016146eb565b9150509250929050565b60008060008060808587031215614a0e57600080fd5b6000614a1c878288016146eb565b9450506020614a2d878288016146eb565b935050604085013567ffffffffffffffff811115614a4a57600080fd5b614a5687828801614652565b925050606085013567ffffffffffffffff811115614a7357600080fd5b614a7f87828801614652565b91505092959194509250565b600080600060608486031215614aa057600080fd5b6000614aae868287016146eb565b9350506020614abf868287016146eb565b9250506040614ad0868287016146eb565b9150509250925092565b60008060008060808587031215614af057600080fd5b6000614afe878288016146eb565b9450506020614b0f878288016146eb565b9350506040614b20878288016146eb565b9250506060614b31878288016146eb565b91505092959194509250565b600080600080600060a08688031215614b5557600080fd5b6000614b63888289016146eb565b9550506020614b74888289016146eb565b9450506040614b85888289016146eb565b9350506060614b96888289016146eb565b9250506080614ba7888289016146eb565b9150509295509295909350565b600080600080600060a08688031215614bcc57600080fd5b6000614bda888289016146eb565b9550506020614beb888289016146eb565b9450506040614bfc888289016146eb565b9350506060614c0d888289016146eb565b925050608086013567ffffffffffffffff811115614c2a57600080fd5b614c368882890161474b565b9150509295509295909350565b600080600080600060a08688031215614c5b57600080fd5b6000614c69888289016146eb565b9550506020614c7a888289016146eb565b9450506040614c8b888289016147dd565b935050606086013567ffffffffffffffff811115614ca857600080fd5b614cb488828901614652565b925050608086013567ffffffffffffffff811115614cd157600080fd5b614cdd88828901614652565b9150509295509295909350565b60008060208385031215614cfd57600080fd5b600083013567ffffffffffffffff811115614d1757600080fd5b614d23858286016146ff565b92509250509250929050565b600080600080600060808688031215614d4757600080fd5b600086013567ffffffffffffffff811115614d6157600080fd5b614d6d888289016146ff565b95509550506020614d80888289016146d7565b9350506040614d91888289016147b5565b9250506060614da2888289016146eb565b9150509295509295909350565b600060208284031215614dc157600080fd5b6000614dcf848285016147a1565b91505092915050565b600060208284031215614dea57600080fd5b6000614df8848285016147b5565b91505092915050565b600060208284031215614e1357600080fd5b6000614e21848285016147c9565b91505092915050565b60008060408385031215614e3d57600080fd5b6000614e4b858286016147b5565b9250506020614e5c8582860161463e565b9150509250929050565b600060208284031215614e7857600080fd5b6000614e86848285016147f1565b91505092915050565b614e9881615ef7565b82525050565b614ea781615e09565b82525050565b614eb681615df7565b82525050565b6000614ec782615db1565b808452602084019350614ed983615d97565b60005b82811015614f0b57614eef868351614f81565b614ef882615ddd565b9150602086019550600181019050614edc565b50849250505092915050565b6000614f2282615dbc565b808452602084019350614f3483615da4565b60005b82811015614f6657614f4a86835161572e565b614f5382615dea565b9150604086019550600181019050614f37565b50849250505092915050565b614f7b81615e1b565b82525050565b614f8a81615e27565b82525050565b614f9981615e31565b82525050565b6000614faa82615dc7565b808452614fbe816020860160208601615f3c565b614fc781615f6f565b602085010191505092915050565b6000614fe082615dd2565b808452614ff4816020860160208601615f3c565b614ffd81615f6f565b602085010191505092915050565b6000601c82527f456e636f64696e67204572726f723a206f666673657420213d20302e000000006020830152604082019050919050565b6000602682527f47534e426f756e636572426173653a2063616c6c6572206973206e6f7420526560208301527f6c617948756200000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f742044454c4554452066726f6d2073797374656d207461626c65006020830152604082019050919050565b6000601a82527f43616e6e6f74205550444154452073797374656d207461626c650000000000006020830152604082019050919050565b6000602682527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160208301527f64647265737300000000000000000000000000000000000000000000000000006040830152606082019050919050565b6000601f82527f43616e6e6f7420494e5345525420696e746f2073797374656d207461626c65006020830152604082019050919050565b6000602b82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f63757272656e74206f6e650000000000000000000000000000000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20555044415445206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602082527f4572726f723a206b65792065786973747320696e206f7468657220646963742e6020830152604082019050919050565b6000601582527f726f7720616c726561647920686173206f776e657200000000000000000000006020830152604082019050919050565b6000601082527f4572726f7220616c69676e6d656e742e000000000000000000000000000000006020830152604082019050919050565b6000603982527f4e6f7420726f774f776e6572206f72206f776e65722f64656c6567617465206660208301527f6f722055504441544520696e746f2074686973207461626c65000000000000006040830152606082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e20494e53455254206960208301527f6e746f2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000601282527f6572726f722072656d6f76696e67206b657900000000000000000000000000006020830152604082019050919050565b6000602082527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726020830152604082019050919050565b6000602e82527f436f6e747261637420696e7374616e63652068617320616c726561647920626560208301527f656e20696e697469616c697a65640000000000000000000000000000000000006040830152606082019050919050565b6000601782527f69642b6669656c6420616c7265616479206578697374730000000000000000006020830152604082019050919050565b6000602e82527f4f6e6c79206f776e65722f64656c65676174652063616e2044454c455445206660208301527f726f6d2074686973207461626c650000000000000000000000000000000000006040830152606082019050919050565b6000602c82527f47534e436f6e746578743a206e65772052656c6179487562206973207468652060208301527f7a65726f206164647265737300000000000000000000000000000000000000006040830152606082019050919050565b6000601382527f496e76616c6964207461626c65207479706521000000000000000000000000006020830152604082019050919050565b6000601482527f5461626c6520616c7265616479206578697374730000000000000000000000006020830152604082019050919050565b6000601082527f696420646f65736e2774206578697374000000000000000000000000000000006020830152604082019050919050565b6000601182527f7461626c65206e6f7420637265617465640000000000000000000000000000006020830152604082019050919050565b6000601382527f4b657920646f6573206e6f7420657869737421000000000000000000000000006020830152604082019050919050565b6000601c82527f696420646f65736e27742065786973742c2075736520494e53455254000000006020830152604082019050919050565b6000601482527f7461626c6520646f6573206e6f742065786973740000000000000000000000006020830152604082019050919050565b6000601782527f53656e646572206e6f74206f776e6572206f6620726f770000000000000000006020830152604082019050919050565b6040820160008201516157446000850182614f81565b5060208201516157576020850182614f81565b50505050565b60006040830160008301516157756000860182614f81565b506020830151848203602086015261578d8282614f17565b9150508091505092915050565b6157a381615e7d565b82525050565b6157b281615e87565b82525050565b60006020820190506157cd6000830184614ead565b92915050565b60006020820190506157e86000830184614e8f565b92915050565b60006040820190506158036000830185614ead565b6158106020830184614f90565b9392505050565b600060208201905081810360008301526158318184614ebc565b905092915050565b600060208201905061584e6000830184614f72565b92915050565b60006020820190506158696000830184614f81565b92915050565b60006040820190506158846000830185614f81565b6158916020830184614ead565b9392505050565b600060208201905081810360008301526158b28184614f9f565b905092915050565b600060208201905081810360008301526158d48184614fd5565b905092915050565b600060208201905081810360008301526158f58161500b565b9050919050565b6000602082019050818103600083015261591581615042565b9050919050565b600060208201905081810360008301526159358161509f565b9050919050565b60006020820190508181036000830152615955816150d6565b9050919050565b600060208201905081810360008301526159758161510d565b9050919050565b600060208201905081810360008301526159958161516a565b9050919050565b600060208201905081810360008301526159b5816151a1565b9050919050565b600060208201905081810360008301526159d5816151fe565b9050919050565b600060208201905081810360008301526159f58161525b565b9050919050565b60006020820190508181036000830152615a1581615292565b9050919050565b60006020820190508181036000830152615a35816152c9565b9050919050565b60006020820190508181036000830152615a5581615300565b9050919050565b60006020820190508181036000830152615a758161535d565b9050919050565b60006020820190508181036000830152615a95816153ba565b9050919050565b60006020820190508181036000830152615ab5816153f1565b9050919050565b60006020820190508181036000830152615ad581615428565b9050919050565b60006020820190508181036000830152615af581615485565b9050919050565b60006020820190508181036000830152615b15816154bc565b9050919050565b60006020820190508181036000830152615b3581615519565b9050919050565b60006020820190508181036000830152615b5581615576565b9050919050565b60006020820190508181036000830152615b75816155ad565b9050919050565b60006020820190508181036000830152615b95816155e4565b9050919050565b60006020820190508181036000830152615bb58161561b565b9050919050565b60006020820190508181036000830152615bd581615652565b9050919050565b60006020820190508181036000830152615bf581615689565b9050919050565b60006020820190508181036000830152615c15816156c0565b9050919050565b60006020820190508181036000830152615c35816156f7565b9050919050565b60006020820190508181036000830152615c56818461575d565b905092915050565b6000602082019050615c73600083018461579a565b92915050565b6000604082019050615c8e600083018561579a565b615c9b6020830184614ead565b9392505050565b6000604082019050615cb7600083018561579a565b615cc46020830184614e9e565b9392505050565b6000604082019050615ce0600083018561579a565b8181036020830152615cf28184614f9f565b90509392505050565b6000602082019050615d1060008301846157a9565b92915050565b6000604051905081810181811067ffffffffffffffff82111715615d3957600080fd5b8060405250919050565b600067ffffffffffffffff821115615d5a57600080fd5b602082029050602081019050919050565b600067ffffffffffffffff821115615d8257600080fd5b601f19601f8301169050602081019050919050565b6000602082019050919050565b6000602082019050919050565b600081519050919050565b600081519050919050565b600081519050919050565b600081519050919050565b6000602082019050919050565b6000602082019050919050565b6000615e0282615e5d565b9050919050565b6000615e1482615e5d565b9050919050565b60008115159050919050565b6000819050919050565b60007fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000819050919050565b600064ffffffffff82169050919050565b6000615ea382615e5d565b9050919050565b6000615eb582615e5d565b9050919050565b60008115159050919050565b6000819050919050565b600061ffff82169050919050565b6000819050919050565b600060ff82169050919050565b6000615f0282615f09565b9050919050565b6000615f1482615f1b565b9050919050565b6000615f2682615e5d565b9050919050565b82818337600083830152505050565b60005b83811015615f5a578082015181840152602081019050615f3f565b83811115615f69576000848401525b50505050565b6000601f19601f830116905091905056fea265627a7a723058209bcb1bf16a1085306655d0c2d5d93b34418da7f8b6e9188bde2d9bd1571f27896c6578706572696d656e74616cf50037";
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
		address: "0xE90B0eB7e7CBf32936efde534DacfE2257DcD093",
		updated_at: 1587709143612
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
		address: "0x4758213ffaD552EE16435f003e409b2e9dF65D57",
		updated_at: 1587790288813
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
    this.dateTimeContractAddr = options.dateTimeContractAddr;
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
      gasPrice: '1000000000'
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
     * Returns a chainable select object, that finally resolves to a callable Promise
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
     * @param cols Array of column names, name must be 32 chars or less
     * @param values - TODO: get the schema (cached) if possible to do the conversion here
     * @param options - struct
     * @param options.signer
     *
     * @return the bytes32 id for the row
     */

  }, {
    key: "insertRow",
    value: function () {
      var _insertRow = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee4(tableName, cols, values, options) {
        var _defaultOptions, id, _this$_getKeys, idKey, tableKey, instance, ethAddress, i, fieldIdTableKey, fieldKey;

        return _regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                _defaultOptions = {};
                options = Object.assign(_defaultOptions, options);

                if (!(options.id && (options.id.substring(0, 2) !== '0x' || options.id.length !== 66))) {
                  _context4.next = 4;
                  break;
                }

                throw new Error('options.id must be a 32 byte hex string prefixed with 0x');

              case 4:
                if (!(cols.length !== values.length)) {
                  _context4.next = 6;
                  break;
                }

                throw new Error('cols, values arrays must be same length');

              case 6:
                id = Web3.utils.randomHex(32);

                if (options.id) {
                  id = options.id;
                }

                _this$_getKeys = this._getKeys(tableName, id.substring(2)), idKey = _this$_getKeys.idKey, tableKey = _this$_getKeys.tableKey; // TODO: check cache for table schema? Be lazy for now and always check?

                if (options.ethAddress) {
                  instance = this.defaultInstance;
                  ethAddress = options.ethAddress;
                } else {
                  instance = this.ephemeralInstance;
                  ethAddress = this.ephemeralWeb3.accounts[0];
                }

                i = 0;

              case 11:
                if (!(i < cols.length)) {
                  _context4.next = 21;
                  break;
                }

                fieldIdTableKey = namehash("".concat(cols[i], ".").concat(id.substring(2), ".").concat(tableName));
                this.debug && console.log("fieldIdTableKey = ".concat(fieldIdTableKey));
                fieldKey = keccak256(cols[i]);
                this.debug && console.log(tableKey, idKey, fieldKey, id, values[i], ethAddress);
                _context4.next = 18;
                return instance.methods.insertVal(tableKey, idKey, fieldKey, id, values[i]).send({
                  from: ethAddress
                });

              case 18:
                i++;
                _context4.next = 11;
                break;

              case 21:
                return _context4.abrupt("return", id);

              case 22:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this);
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

      var fieldIdTableKey = namehash("".concat(col, ".").concat(id.substring(2), ".").concat(tableName));
      console.log("fieldIdTableKey = ".concat(fieldIdTableKey));
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
      var _getVal2 = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee5(tableName, id, fieldName, fieldType) {
        var val;
        return _regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                _context5.next = 2;
                return this._getVal(tableName, id, fieldName);

              case 2:
                val = _context5.sent;

                if (!fieldType) {
                  _context5.next = 13;
                  break;
                }

                _context5.t0 = fieldType;
                _context5.next = _context5.t0 === constants.FIELD_TYPE.UINT ? 7 : _context5.t0 === constants.FIELD_TYPE.STRING ? 9 : _context5.t0 === constants.FIELD_TYPE.BOOL ? 11 : 13;
                break;

              case 7:
                val = Web3.utils.hexToNumber(val);
                return _context5.abrupt("break", 13);

              case 9:
                val = Web3.utils.hexToString(val);
                return _context5.abrupt("break", 13);

              case 11:
                val = !!Web3.utils.hexToNumber(val);
                return _context5.abrupt("break", 13);

              case 13:
                return _context5.abrupt("return", val);

              case 14:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
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
      var _getGSNBalance = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee6() {
        return _regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                _context6.next = 2;
                return this.ephemeralInstance.methods.getGSNBalance().call();

              case 2:
                return _context6.abrupt("return", _context6.sent);

              case 3:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
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
     * This initializes the fortmatic web3 provider to sign transactions
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
      }

      if (!this.dateTimeContractAddr) {
        throw new Error('Missing DateTime contract address');
      } // console.log(ethAddress, this.defaultInstance)


      return this.defaultInstance.methods.initialize(this.relayHubAddr, this.dateTimeContractAddr).send({
        useGSN: false,
        from: ethAddress,
        gasPrice: this.config.gasPrice
      });
    }
    /*
    ************************************************************************************************************
    * Schema - Create, Update, Remove Table
    ************************************************************************************************************
     */
    // fm call only
    // we pass in ethAddress because we don't wait to wait for a fortmatic async fetch for ethAccounts

  }, {
    key: "createTable",
    value: function createTable(tableName, permission, cols, colTypes, ethAddress) {
      var tableNameValue = Web3.utils.stringToHex(tableName);
      var tableKey = namehash(tableName);

      if (cols.length !== colTypes.length) {
        throw new Error('cols and colTypes array length mismatch');
      }

      if (this.debug) {
        console.log('createTable', tableKey);
        console.log(tableNameValue);
        console.log('cols', cols);
        console.log('colTypes', colTypes); // this should only work locally, fortmatic would use a different path

        console.log(ethAddress || this.defaultWeb3.eth.personal.currentProvider.addresses[0]);
        console.log('gasPrice', this.config.gasPrice);
      }

      return this.defaultInstance.methods.createTable(tableNameValue, tableKey, permission, cols, colTypes).send({
        useGSN: false,
        from: ethAddress || this.defaultWeb3.eth.personal.currentProvider.addresses[0],
        gasPrice: this.config.gasPrice,
        gas: 1500000
      });
    }
  }, {
    key: "getTableMetadata",
    value: function () {
      var _getTableMetadata = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee7(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                tableKey = namehash(tableName);
                _context7.next = 3;
                return this.ephemeralInstance.methods.getTableMetadata(tableKey).call();

              case 3:
                return _context7.abrupt("return", _context7.sent);

              case 4:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function getTableMetadata(_x11) {
        return _getTableMetadata.apply(this, arguments);
      }

      return getTableMetadata;
    }()
  }, {
    key: "getTableSchema",
    value: function () {
      var _getTableSchema = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee8(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                tableKey = namehash(tableName);
                _context8.next = 3;
                return this.ephemeralInstance.methods.getSchema(tableKey).call();

              case 3:
                return _context8.abrupt("return", _context8.sent);

              case 4:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this);
      }));

      function getTableSchema(_x12) {
        return _getTableSchema.apply(this, arguments);
      }

      return getTableSchema;
    }()
  }, {
    key: "getTableIds",
    value: function () {
      var _getTableIds = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee9(tableName) {
        var tableKey;
        return _regeneratorRuntime.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                tableKey = namehash(tableName);
                _context9.next = 3;
                return this.ephemeralInstance.methods.getTableIds(tableKey).call();

              case 3:
                return _context9.abrupt("return", _context9.sent);

              case 4:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this);
      }));

      function getTableIds(_x13) {
        return _getTableIds.apply(this, arguments);
      }

      return getTableIds;
    }()
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
}, bytesToTypes, {}, typesToBytes);

export default exports;
