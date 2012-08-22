<?php
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
 * These classes provide filters that modify the dynamic query that fetches the nodes. Depending on
 * what node is being requested and what that node's ancestor nodes are, a different combination
 * of filters will be applied. There is one class per type of node, and one method with the class
 * for the type of operation. If there is a courseid node as an ancestor, we want to use the
 * courseid::where_filter, but if we are asking for courseid nodes, we want the
 * courseid::count_select filter.
 *
 * @package    block
 * @subpackage ajax_marking
 * @copyright  2012 Matt Gibson
 * @author     Matt Gibson {@link http://moodle.org/user/view.php?id=81450}
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

global $CFG;

require_once($CFG->dirroot.'/blocks/ajax_marking/filters/base.class.php');

/**
 * Makes the query retrieve the highest visible groupid for each submission. This takes account of the fact that
 * students can be in more than one group and those groups may or may not be hidden by the block settings. We
 * always want this to be used so we can filter based on settings.
 */
class block_ajax_marking_filter_groupid_attach_highest extends block_ajax_marking_query_decorator_base {

    /**
     * This will add a groupid to each of the submissions coming out of the moduleunion. This means getting
     * all the group memberships for this course and choosing the maximum groupid. We can't count more than
     * once when students are in two groups, so we need to do it like this. It's a greatest-n-per-group
     * problem, solved with the classic left-join approach.
     *
     * @return void
     */
    protected function alter_query() {

        $query = $this->wrappedquery;

        list($visibilitysubquery, $visibilityparams) = block_ajax_marking_group_visibility_subquery();
        list($gmaxvisibilitysubquery, $gmaxvisibilityparams) = block_ajax_marking_group_visibility_subquery();

        // These three table get us a group id that's not hidden based on the user's group memberships.
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => 'groups_members',
                 'alias' => 'gmember_members',
                 'on' => 'gmember_members.userid = '.$query->get_column('userid')
            ));
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => 'groups',
                 'alias' => 'gmember_groups',
                 'on' => 'gmember_groups.id = gmember_members.groupid'.
                       ' AND gmember_groups.courseid = '.$query->get_column('courseid')
            )
        );
        // This subquery has all the group-coursemoudule combinations that he user has configured as hidden via
        // the block settings. We want this to be null as any value shows that the user has chosen it to be hidden.
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => $visibilitysubquery,
                 'subquery' => true,
                 'alias' => 'gvis',
                 'on' => 'gvis.groupid = gmember_groups.id
                    AND gvis.coursemoduleid = '.$query->get_column('coursemoduleid')
            ));
        $query->add_params($visibilityparams);

        // These three tables are used to make sure that if we have multiple group memberships, we won't have a problem
        // because the highest of the available group ids will be chosen. This is a greatest-n-per-group solution.
        // By joining only to tables with a higher group id, then specifying that the joined table must be null,
        // we only get the maximum.
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => 'groups_members',
                 'alias' => 'gmax_members',
                 'on' => 'gmax_members.userid = '.$query->get_column('userid').
                          ' AND gmax_members.groupid > gmember_members.groupid'
            ));
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => 'groups',
                 'alias' => 'gmax_groups',
                 'on' => 'gmax_groups.id = gmax_members.groupid '.
                       ' AND gmax_groups.courseid = '.$query->get_column('courseid')
            )
        );
        $query->add_from(
            array(
                 'join' => 'LEFT JOIN',
                 'table' => $gmaxvisibilitysubquery,
                 'subquery' => true,
                 'alias' => 'gvismax',
                 'on' => 'gvismax.groupid = gmax_groups.id
                    AND gvismax.coursemoduleid = '.$query->get_column('coursemoduleid')
            ));
        $query->add_params($gmaxvisibilityparams);

        // Due to using two tables for the left joins, we need to make sure they either match or are both null. Because
        // we may have two groups and because we may wish to ignore one of them, we specify that we cannot
        // have mixed nulls and groupids for the first set of tables that we are reading from, but the second, we
        // either want nothing, or we allow.
        $query->add_where(
            array(
                 'type' => 'AND',
                 'condition' => '((gmember_groups.id = gmember_members.groupid)
                                  OR (gmember_groups.id IS NULL AND gmember_members.groupid IS NULL))'
            )
        );
        $query->add_where(
            array(
                 'type' => 'AND',
                 'condition' => '(gmax_members.groupid IS NULL OR gvismax.groupid IS NOT NULL)'
            )
        );

        $query->add_where(
            array(
                 'type' => 'AND',
                 'condition' => 'gvis.groupid IS NULL'
            ));

        $memberquery = "
            /* Joins directly to the rest of the stuff from the module union row. Would get the membership if there */
            /* was only one with no settings. */
     LEFT JOIN {groups_members} gmember_members
            ON gmember_members.userid = {$query->get_column('userid')}
     LEFT JOIN {groups} gmember_groups
            ON gmember_groups.id = gmember_members.groupid
            AND gmember_groups.courseid = {$query->get_column('courseid')}

        /* This is the greatest n per group join which makes sure there are no other group memberships with lower ids.*/
        /* i.e. it gets one group membership if there are two. */

       LEFT JOIN {groups_members} gmax_members
              ON gmax_members.userid = gmax_members.userid
             AND gmax_members.groupid > gmember_members.groupid
       LEFT JOIN {groups} gmax_groups
              ON gmax_groups.id = gmax_members.groupid
              AND gmax_groups.courseid = {$query->get_column('courseid')}
           WHERE gmax_members.id IS NULL

        ";

//        $maxquery = "
//        SELECT gmax_members.userid,
//               gmax_groups.id AS groupid,
//               gmax_course_modules.id AS coursemoduleid,
//               CASE
//                   WHEN visquery.groupid IS NULL THEN 1
//                   ELSE 0
//               END AS display
//
//    INNER JOIN {course_modules} gmax_course_modules
//            ON gmax_course_modules.course = gmax_groups.courseid
//     LEFT JOIN ({$visibilitysubquery}) visquery
//            ON visquery.groupid = gmax_groups.id
//               AND visquery.coursemoduleid = gmax_course_modules.id
//           /* Limit the size of the subquery for performance */
//         WHERE visquery.groupid IS NULL
//
//        ";



    }
}
