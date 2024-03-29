/**
 * 用户管理模块
 */
const router = require('koa-router')()
const User = require('../models/userSchema')
const Menu = require('../models/menuSchema')
const Role = require('../models/roleSchema')
const Dept = require('../models/deptSchema')
const Counter = require('../models/counterSchema')
const util = require('../utils/util')
const md5 = require('md5')
const jwt = require('jsonwebtoken')
router.prefix('/users')

// 用户登录
router.post('/login', async (ctx, next) => {

 try {
    const { userName, userPwd } = ctx.request.body
    /**
     * 返回数据库指定字段，有三种方式
     * 1. 'userId userName userEmail state role deptId roleList'
     * 2. {userId:1,_id:0}
     * 3. select('userId')
     */
    const res = await User.findOne({
      userName,
      userPwd: md5(userPwd)
    }, 'userId userName userEmail state role deptId roleList')

    const data = res._doc
    
    const token = jwt.sign({
      data
    }, 'licop', { expiresIn: '1h' })
    console.log("data=>", data, 32)
    if(res) {
      data.token = token
      ctx.body = util.success(data)
    } else {
      ctx.body = util.fail('账号或者密码不正确')
    }
  } catch (err) {
    ctx.body = util.fail(err.msg)
  }
})

// 用户列表
router.get('/list',async (ctx) => {
  const { userName, userId, state } = ctx.request.query
  const { page, skipIndex } = util.pager(ctx.request.query)

  let params = {}

  if(userId) params.userId = userId
  if(userName) params.userName = userName
  if(state && state != '0') params.state = state
  

  try {
    // 根据条件查询所有的用户列表
    const query = User.find(params, { _id: 0, userPwd: 0 })
    let list = await query.skip(skipIndex).limit(page.pageSize)
    const total = await User.countDocuments(params)
    

    for(let item of list) {
      const res = await Dept.findById(item.deptId[item.deptId.length - 1])
      item.deptName = res.deptName
    }
    
    ctx.body = util.success({
      page: {
        ...page,
        total
      },
      list
    })
  } catch (error) {
    ctx.body = util.fail(`查询异常：${error.stack}`)
  }

})

// 获取全量用户列表
router.get('/all/list', async (ctx) => {
  try {
    const list = await User.find({}, "userId userName userEmail")
    ctx.body = util.success(list)
  } catch (error) {
    ctx.body = util.fail(error.stack)
  }
})

// 用户删除/批量删除
router.post('/delete', async (ctx) => {
  // 待删除的用户Id数组
  const { userIds } = ctx.request.body
  const res = await User.updateMany({ userId: { $in: userIds } }, { state: 2 })
  if (res.modifiedCount > 0) {
    res.nModified = res.modifiedCount
    ctx.body = util.success(res, `共删除成功${res.modifiedCount}条`)
  } else {
    ctx.body = util.fail('删除失败');
  }
})

// 用户新增/编辑
router.post('/operate', async (ctx) => {
  const { userId, userName, userEmail, job, state, roleList, deptId, mobile, action } = ctx.request.body
  
  if(action === 'add') {
    if(!userName || !userEmail || !deptId) {
      ctx.body = util.fail('参数错误', util.CODE.PARAM_ERROR)
      return
    } 
    const res = await User.findOne({ $or: [{ userName }, { userEmail }] }, '_id userName userEmail')
    if(res) {
      ctx.body = util.fail(`系统监测到有重复的用户，信息如下：${res.userName} - ${res.userEmail}`)
    } else {
      const doc = await Counter.findOneAndUpdate({ _id: 'userId' }, { $inc: { sequence_value: 1 } }, { new: true })
      
      try {
        const user = new User({
          userId: doc.sequence_value,
          userName,
          userEmail,
          userPwd: md5('123456'),
          role: 1, // 默认普通用户
          roleList,
          job,
          state,
          deptId,
          mobile
        })

        user.save()
        ctx.body = util.success('', '用户创建成功')
      
      } catch (error) {
        ctx.body = util.fail(error.stack, '用户创建失败')
      }
    }
  } else {
    if(!deptId) {
      ctx.body = util.fail('部门不能为空', util.CODE.PARAM_ERROR)
      return
    }
    try {
      const res = await User.findOneAndUpdate({ userId }, { job, state, roleList, deptId, mobile })
      ctx.body = util.success('', '更新成功')
    } catch (error) {
      ctx.body = util.fail(error.stack, '更新失败')
    }
    
  }
})

// 获取用户对应权限菜单
router.get('/getPermisssionList', async (ctx) => {
  let authorization = ctx.request.headers.authorization
  let { data } = util.decoded(authorization)
  let menuList = await getMenuList(data.role, data.roleList)
  // 深拷贝
  let actionList = getAction(JSON.parse(JSON.stringify(menuList)))
  ctx.body = util.success({ menuList, actionList })
})

async function getMenuList(userRole, roleKeys) {
  let rootList = []
  // 如果用户角色是负责人
  if(userRole === 0) {
    rootList = await Menu.find({}) || []
  } else {
    // 根据用户拥有的角色，获取权限列表
    // 现查找用户对应角色有哪些
    let roleList = await Role.find({_id: { $in: roleKeys }})
    let permissionList = []
    roleList.map(role => {
      let { checkedKeys, halfCheckedKeys } = role.permissionList;
      permissionList = permissionList.concat([...checkedKeys, ...halfCheckedKeys])
    })
    permissionList = [...new Set(permissionList)]
    // 根据勾选权限去找对应的菜单
    rootList = await Menu.find({_id: { $in: permissionList }})
  }
  
  return util.getTreeMenu(rootList, null, [])
}

function getAction(list) {
  let actionList = []
  const deep = (arr) => {
    while (arr.length) {
      let item = arr.pop();
      if (item.action) {
        item.action.map(action => {
          actionList.push(action.menuCode)
        })
      }
      if (item.children && !item.action) {
        deep(item.children)
      }
    }
  }
  deep(list)
  return actionList;
}

module.exports = router
