import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bagPlayCommand, bagRecordCommand, isBagName, launchCommand, isParamName, isParamService, isRosName, isSrvType, parseBags, parseLaunches, parseParamDump, parseRosList, parseServices, requestTemplate } from './rosparse.mts'

test('ROS2 토픽·노드 목록', () => {
  const r = parseRosList(`__DISTRO__=jazzy
__TOPICS__
/chatter [std_msgs/msg/String]
/parameter_events [rcl_interfaces/msg/ParameterEvent]
/rosout [rcl_interfaces/msg/Log]
__NODES__
/talker
/listener
`)
  assert.equal(r?.distro, 'jazzy')
  assert.deepEqual(r?.topics[0], { name: '/chatter', type: 'std_msgs/msg/String' })
  assert.equal(r?.topics.length, 3)
  assert.deepEqual(r?.nodes, ['/talker', '/listener'])
  assert.equal(parseRosList('__NOROS__\n'), null)
  assert.deepEqual(parseRosList('__DISTRO__=jazzy\n__TOPICS__\n__NODES__\n')?.topics, [])
})

test('launch 파일 목록', () => {
  const l = parseLaunches(`/opt/ros/jazzy/share/demo_nodes_cpp/launch/topics/talker_listener.launch.py
/home/u/ros2_ws/src/my_robot/launch/bringup.launch.py
/opt/ros/jazzy/share/demo_nodes_cpp/launch/topics/talker_listener.launch.py
/opt/ros/jazzy/share/demo_nodes_cpp/launch/services/add_two_ints_launch.py
/opt/ros/jazzy/share/demo_nodes_cpp/launch/topics/talker_listener_best_effort_launch.yaml
/opt/ros/jazzy/share/x/launch/prelaunch.py
/home/u/notes.txt
`)
  assert.equal(l.length, 4) // _launch.py·_launch.yaml도 찾고, prelaunch.py는 아님
  assert.deepEqual(l[0], { pkg: null, file: 'bringup.launch.py', path: '/home/u/ros2_ws/src/my_robot/launch/bringup.launch.py' })
  assert.equal(l[1].pkg, 'demo_nodes_cpp')
})

test('ROS 이름 검사', () => {
  assert.ok(isRosName('/chatter') && isRosName('/robot1/cmd_vel'))
  assert.ok(!isRosName("/a'; rm -rf ~") && !isRosName('chatter') && !isRosName('/a b'))
})

test('서비스 목록·요청 뼈대·파라미터 서비스 구분', () => {
  const s = parseServices(`/add_two_ints [example_interfaces/srv/AddTwoInts]
/talker/get_parameters [rcl_interfaces/srv/GetParameters]
`)
  assert.deepEqual(s?.[0], { name: '/add_two_ints', type: 'example_interfaces/srv/AddTwoInts' })
  assert.equal(s?.length, 2)
  assert.equal(parseServices('__NOROS__\n'), null)
  assert.deepEqual(parseServices(''), [])
  assert.ok(isParamService('/talker/get_parameters') && !isParamService('/add_two_ints'))
  assert.equal(requestTemplate('int64 a\nint64 b\n---\nint64 sum\n'), '{a: 0, b: 0}')
  assert.equal(requestTemplate('# c\nbool data # x\nstring name\nfloat64[] v\ngeometry_msgs/Pose pose\nuint8 K=1\n---\nbool ok'), "{data: false, name: '', v: [], pose: {}}")
  assert.equal(requestTemplate('---\nbool success\nstring message'), '{}') // 요청이 비어 있는 서비스(std_srvs/Empty·Trigger)
  assert.ok(isSrvType('example_interfaces/srv/AddTwoInts') && !isSrvType("x'; rm -rf /"))
})

test('파라미터 dump 읽기 (중첩·목록 이름은 점으로)', () => {
  const p = parseParamDump(`/talker:
  ros__parameters:
    qos_overrides:
      /parameter_events:
        publisher:
          depth: 1000
          durability: volatile
    start_type_description_service: true
    gains:
    - 1.0
    - 2.5
    names: []
    use_sim_time: false
/other:
  ros__parameters:
    x: 1
`)
  assert.deepEqual(p.map((x) => x.name), ['qos_overrides./parameter_events.publisher.depth', 'qos_overrides./parameter_events.publisher.durability', 'start_type_description_service', 'gains', 'names', 'use_sim_time'])
  assert.deepEqual(p.map((x) => x.value), ['1000', 'volatile', 'true', '[1.0, 2.5]', '[]', 'false'])
  assert.deepEqual(parseParamDump(''), [])
  assert.ok(isParamName('qos_overrides./parameter_events.publisher.depth') && !isParamName('a b') && !isParamName("a'b"))
})

test('bag 목록·재생·녹화 명령', () => {
  const b = parseBags('/home/u/z_bag/metadata.yaml\n/home/u/a bag/metadata.yaml\n/home/u/z_bag/metadata.yaml\nnoise\n')
  assert.deepEqual(b, [{ path: '/home/u/a bag', name: 'a bag' }, { path: '/home/u/z_bag', name: 'z_bag' }])
  assert.equal(bagPlayCommand('/home/u/a bag', false, 1), "ros2 bag play '/home/u/a bag'")
  assert.equal(bagPlayCommand("/x/it's", true, 0.5), "ros2 bag play '/x/it'\\''s' -l -r 0.5")
  assert.equal(bagRecordCommand('b1', []), 'ros2 bag record -o b1 -a')
  assert.equal(bagRecordCommand('b1', ['/chatter', '/tf']), "ros2 bag record -o b1 '/chatter' '/tf'")
  assert.equal(launchCommand({ pkg: 'demo_nodes_cpp', file: 'a.launch.py', path: '/x' }), "ros2 launch 'demo_nodes_cpp' 'a.launch.py'")
  assert.equal(launchCommand({ pkg: null, file: 'b.launch.py', path: '/home/u/ws/b.launch.py' }), "ros2 launch '/home/u/ws/b.launch.py'")
  assert.ok(isBagName('bag_2026-10-23') && !isBagName('a b') && !isBagName('../x'))
})
