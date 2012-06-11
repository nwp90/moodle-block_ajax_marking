// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Javascript for the AJAX Marking block base tree, which other trees extend.
 *
 * @package    block
 * @subpackage ajax_marking
 * @copyright  20012 Matt Gibson
 * @author     Matt Gibson {@link http://moodle.org/user/view.php?id=81450}
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

YUI.add('moodle-block_ajax_marking-markingtree', function (Y) {

    /**
     * Name of this module as used by YUI.
     * @type {String}
     */
    var MARKINGTREENAME = 'markingtree';

    var MARKINGTREE = function () {
        MARKINGTREE.superclass.constructor.apply(this, arguments);
        this.singleNodeHighlight = true;
    };

    Y.extend(MARKINGTREE, YAHOO.widget.TreeView, {

        // Keeps track of whether this tree needs to be refreshed when the tab changes (if config
        // settings have been altered).
        needsrefresh : false,

        /**
         * Subclasses may wish to have different nodes.
         */
        nodetype : M.block_ajax_marking.tree_node,

        /**
         * New unified build nodes function.
         *
         * @param {Array} nodesarray
         */
        build_nodes : function (nodesarray, nodeindex) {

            var newnode,
                nodedata,
                islastnode,
                numberofnodes = nodesarray.length,
                parentnode;

            if (nodeindex) {
                parentnode = this.getNodeByProperty('index', nodeindex)
            } else {
                parentnode = this.getRoot();
            }

            // Remove nodes here so we avoid lag due to AJAX between removal and addition.
            this.removeChildren(parentnode);

            // Cycle through the array and make the nodes.
            for (var i = 0; i < numberofnodes; i++) {

                nodedata = nodesarray[i];

                // Make the display data accessible to the node creation code.
                nodedata.html = nodedata.displaydata.name;

                newnode = new this.nodetype(nodedata, parentnode, false);
                newnode.set_count(newnode.get_count(false)); // Needed to convert to int.

                // Some nodes won't be specific to a module, but this needs to be specified to avoid
                // silent errors.
                // TODO make this happen as part of the constructor process.
                newnode.set_nextnodefilter(this.nextnodetype(newnode));

                islastnode = (newnode.get_nextnodefilter() === false);

                // Set the node to load data dynamically, unless it has not sent a callback i.e.
                // it's a final node.
                if (!islastnode) {
                    newnode.setDynamicLoad(this.request_node_data);
                }

                // If the node has a time (of oldest submission) show urgency by adding a
                // background colour.
                newnode.set_time_style();
            }

            // Finally, run the function that updates the original node and adds the children. Won't
            // be there if we have just built the tree.
            parentnode.loadComplete();
            // Update the counts on all the nodes in case extra work has just appeared.
            if (parentnode.recalculate_counts) {
                parentnode.recalculate_counts(); // will update total if necessary
            } else { // Root node.
                // The main tree will need the counts updated, but not the config tree.
                this.update_total_count();
            }
        },

        /**
         * Builds the tree when the block is loaded, or refresh is clicked
         *
         * @return void
         */
        initialise : function () {

            // Get rid of the existing tree nodes first (if there are any), but don't re-render to
            // avoid flicker.
            var rootnode = this.getRoot();
            this.removeChildren(rootnode);

            // Reload the data for the root node. We keep the tree object intact rather than
            // destroying and recreating in order to improve responsiveness.
            M.block_ajax_marking.parentnodeholder = rootnode;
            // If we don't do this, then after refresh, we get it trying to run the oncomplete thing
            // from the last node that was expanded.
            M.block_ajax_marking.oncompletefunctionholder = null;

            // Show that the ajax request has been initialised.
            YAHOO.util.Dom.addClass(document.getElementById('mainicon'), 'loaderimage');

            // Send the ajax request.
            YAHOO.util.Connect.asyncRequest('POST', M.block_ajax_marking.ajaxnodesurl,
                                            M.block_ajax_marking.callback, this.initial_nodes_data);
            this.add_loading_icon();

        },

        /**
         * Sorts things out after nodes have been added, or an error happened (so refresh still
         * works)
         */
        rebuild_parent_and_tree_count_after_new_nodes : function () {
            // finally, run the function that updates the original node and adds the children. Won't
            // be there if we have just built the tree
            if (typeof(M.block_ajax_marking.oncompletefunctionholder) === 'function') {
                // Take care - this will be executed in the wrong scope if not careful. it needs
                // this to be the tree
                M.block_ajax_marking.oncompletefunctionholder(); // node.loadComplete()
                M.block_ajax_marking.oncompletefunctionholder = ''; // prevent it firing next time
                M.block_ajax_marking.parentnodeholder.recalculate_counts();
            } else {
                // The initial build doesn't set oncompletefunctionholder for the root node, so
                // we do it manually
                this.getRoot().loadComplete();
                // the main tree will need the counts updated, but not the config tree
                //this.update_parent_node(M.block_ajax_marking.parentnodeholder);
                this.update_total_count();
            }

        },

        /**
         * This function is called when a node is clicked (expanded) and makes the ajax request. It
         * sends the filters from all parent nodes and the nextnodetype
         *
         * @param clickednode
         */
        request_node_data : function (clickednode) {

            // The callback function is the SQL GROUP BY for the next set of nodes, so this is
            // separate
            var nodefilters = clickednode.get_filters(true);
            nodefilters.push(clickednode.get_nextnodefilter()+'=nextnodefilter');
            // This lets the AJAX success code find the right node to add stuff to
            nodefilters.push('nodeindex='+clickednode.index);
            nodefilters = nodefilters.join('&');

            YAHOO.util.Connect.asyncRequest('POST',
                                            M.block_ajax_marking.ajaxnodesurl,
                                            M.block_ajax_marking.callback,
                                            nodefilters);

        },

        /**
         * Recalculates the total marking count by totalling the node counts of the tree
         *
         * @return void
         */
        recalculate_total_count : function () {
            var count = 0;
            this.totalcount = 0;
            var children = this.getRoot().children;
            var childrenlength = children.length;

            for (var i = 0; i < childrenlength; i++) {
                count = children[i].get_count();
                if (count) {
                    this.totalcount += count;
                }
            }
        },

        /**
         * Makes it so that the total count displays the count of this tree
         */
        update_total_count : function () {
            this.recalculate_total_count();
            this.countdiv.innerHTML = this.totalcount.toString();
        },

        /**
         * This function updates the tree to remove the node of the pop up that has just been
         * marked, then it updates the parent nodes and refreshes the tree, then sets a timer so
         * that the popup will be closed when it goes to the 'changes saved' url.
         *
         * @param nodeuniqueid The id of the node to remove
         * @return void
         */
        remove_node : function (nodeuniqueid) {
            var nodetoremove = this.getNodeByProperty('index', nodeuniqueid);
            var parentnode = nodetoremove.parent;
            this.hide_context_menu_before_node_removal(nodetoremove);
            this.removeNode(nodetoremove, true); // don't refresh yet because the counts will be wrong
            parentnode.recalculate_counts();
        },

        /**
         * If a node is removed, it might have it's context menu open. This will check and hide the
         * context menu if it is. We don't want to hide the context menu if it's a child node of the
         * contextmenu's node.
         *
         * @param nodebeingremoved
         */
        hide_context_menu_before_node_removal : function (nodebeingremoved) {
            var currenttab = M.block_ajax_marking.get_current_tab();
            if (currenttab.contextmenu &&
                currenttab.contextmenu.clickednode &&
                currenttab.contextmenu.clickednode == nodebeingremoved) {

                currenttab.contextmenu.hide();
            }
        },

        /**
         * Empty function so that different tree subtypes can overrride. Used to initialise any
         * stuff that appears as part of the nodes e.g. groups dropdowns in the config tree.
         */
        add_groups_buttons : function () {
        },

        /**
         * Tells us whether a flag was set by another tree saying that the rest need a refresh. The
         * tree that has changed settings notifies the others so that they can lazyload refresh when
         * clicked on.
         */
        needs_refresh : function () {
            return this.needsrefresh;
        },

        /**
         * Sets whether or not the tree ought to be refreshed when the tab changes
         * @param {boolean} value
         */
        set_needs_refresh : function (value) {
            this.needsrefresh = value;
        },

        /**
         * Tell other trees they need a refresh. Subclasses to override
         */
        notify_refresh_needed : function () {

        },

        /**
         * When a node has requested an updated count via AJAX (because it is not expanded and its
         * groups settings have changed), this function does the update
         *
         * @param newcounts
         * @param nodeindex
         */
        update_node_count : function (newcounts, nodeindex) {
            var node = this.getNodeByIndex(nodeindex);
            node.set_count(newcounts.recentcount, 'recent');
            node.set_count(newcounts.mediumcount, 'medium');
            node.set_count(newcounts.overduecount, 'overdue');
            node.set_count(newcounts.itemcount);

            if (node.parent.recalculate_counts) {
                node.parent.recalculate_counts();
            } else {
                this.update_total_count();
            }
        },

        /**
         * If all child nodes need the counts updated because groups settings have changed, this is
         * called in order to do it
         *
         * @param arrayofnodes
         * @param nodeindex
         */
        update_child_node_counts : function (arrayofnodes, nodeindex) {

            var childnode,
                childnodedata,
                node = this.getNodeByIndex(nodeindex),
                nextnodefilter = node.get_nextnodefilter(),
                recent = 0,
                medium = 0,
                overdue = 0;

            for (var i = 0; i < arrayofnodes.length; i++) {

                childnodedata = arrayofnodes[i];
                childnode = node.get_child_node_by_filter_id(nextnodefilter,
                                                             childnodedata[nextnodefilter]);

                if (parseInt(childnode.itemcount) === 0) {
                    this.remove_node(childnode);
                    continue;
                }

                childnode.set_count(childnodedata.recentcount, 'recent');
                childnode.set_count(childnodedata.mediumcount, 'medium');
                childnode.set_count(childnodedata.overduecount, 'overdue');
                childnode.set_count(childnodedata.itemcount);
            }

            node.recalculate_counts();
        },

        /**
         * Changes the refresh button into a loading icon button
         */
        add_loading_icon : function () {
            this.tab.refreshbutton.set('label',
                                       '<img src="'+M.cfg.wwwroot+
                                           '/blocks/ajax_marking/pix/ajax-loader.gif"'+
                                           ' class="refreshicon"'+
                                           ' alt="'+M.str.block_ajax_marking.refresh+'" />');
            this.tab.refreshbutton.focus();

        },

        /**
         * Changes the loading icon button back to a refresh button
         */
        remove_loading_icon : function () {
            this.tab.refreshbutton.set('label',
                                       '<img src="'+M.cfg.wwwroot+
                                           '/blocks/ajax_marking/pix/refresh-arrow.png"'+
                                           ' class="refreshicon"'+
                                           ' alt="'+M.str.block_ajax_marking.refresh+'" />');
            this.tab.refreshbutton.blur();
        }

    }, {
        NAME : MARKINGTREENAME, //module name is something mandatory.
        // It should be in lower case without space
        // as YUI use it for name space sometimes.
        ATTRS : {
            // TODO make this so that courses and cohorts tree use exactly the same code. Difference
            // will be params passed in: order of nodes and init code.
        }
    });

    M.block_ajax_marking = M.block_ajax_marking || {};

    /**
     * Makes the new class accessible.
     *
     * @param config
     * @return {*}
     */
    M.block_ajax_marking.markingtree = MARKINGTREE;

}, '1.0', {
    requires : ['yui2-treeview']
});


