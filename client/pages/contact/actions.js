'use strict';
const ApiActions = require('../../actions/api/admin');
const Constants = require('./constants');
const Store = require('./store');


class Actions {
    static sendMessage(data) {

        ApiActions.post(
            '/api/admin/contact',
            data,
            Store,
            Constants.SEND_MESSAGE,
            Constants.SEND_MESSAGE_RESPONSE
        );
    }
}


module.exports = Actions;
